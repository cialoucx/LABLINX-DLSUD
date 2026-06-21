const express = require("express");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const { adminCategoryMapping } = require("../config/constants");
const { broadcastRefresh } = require("../utils/websocket");
const { findModelAndItemForAdmin, logAdminAction } = require("./helpers");
const ItemRequest = require("../models/ItemRequest");
const ItemHistory = require("../models/ItemHistory");
const Incident = require("../models/Incident");

const {
  Inventory,
  ScienceInventory,
  SportsInventory,
  FurnitureInventory,
  ComputerInventory,
  FoodLabInventory,
  RoboticsInventory,
  MusicInventory,
  allInventoryModels,
} = require("../models/Inventory");

const router = express.Router();

const createCrudRoutes = (apiPath, Model) => {
  // GET all active items
  router.get(apiPath, isAuthenticated, async (req, res) => {
    try {
      const items = await Model.find({ status: { $ne: "Decommissioned" } });
      res.json(items);
    } catch (e) {
      res.status(500).json({ message: "Error fetching items." });
    }
  });

  // POST new items (single or batch)
  router.post(apiPath, isAdmin, async (req, res) => {
    try {
      const incomingData = req.body;
      const itemsToInsert = Array.isArray(incomingData)
        ? incomingData
        : [incomingData];

      // Validate required fields
      for (const item of itemsToInsert) {
        if (!item.itemId || !item.name || !item.category) {
          return res.status(400).json({
            message:
              "Missing required fields: itemId, name, and category are required.",
          });
        }
      }

      // Check for duplicates in incoming batch
      const itemIds = itemsToInsert.map((item) => item.itemId);
      const normalizedForBatchCheck = itemIds.map((id) =>
        String(id).trim().toUpperCase(),
      );
      const duplicateInBatch = normalizedForBatchCheck.filter(
        (id, index) => normalizedForBatchCheck.indexOf(id) !== index,
      );
      if (duplicateInBatch.length > 0) {
        const uniqueDuplicates = [...new Set(duplicateInBatch)];
        return res.status(409).json({
          message: `Duplicate Item IDs found in the request: ${uniqueDuplicates.join(
            ", ",
          )}. Each Item ID must be unique (case-insensitive).`,
        });
      }

      // Check for duplicates in the DB
      const normalizedItemIds = itemIds.map((id) =>
        String(id).trim().toUpperCase(),
      );
      const allItems = await Model.find({});
      const existingItems = [];

      for (const normalizedId of normalizedItemIds) {
        const match = allItems.find(
          (item) => String(item.itemId).trim().toUpperCase() === normalizedId,
        );
        if (match) {
          existingItems.push(match);
        }
      }

      if (existingItems.length === 0) {
        const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const existingItemsQueries = normalizedItemIds.map((normalizedId) => ({
          itemId: { $regex: new RegExp(`^${escapeRegex(normalizedId)}$`, "i") },
        }));

        const regexMatches = await Model.find({
          $or: existingItemsQueries,
        });

        if (regexMatches.length > 0) {
          existingItems.push(...regexMatches);
        }
      }

      if (existingItems.length > 0) {
        const duplicates = existingItems.map((item) => item.itemId);
        const modelName = Model.modelName || "Inventory";
        const duplicateList =
          duplicates.length <= 5
            ? duplicates.join(", ")
            : `${duplicates.slice(0, 5).join(", ")} and ${duplicates.length - 5} more`;

        return res.status(409).json({
          message: `The following Item ID(s) already exist in this inventory table: ${duplicateList}. Each Item ID must be unique within the same inventory table (case-insensitive).`,
        });
      }

      // Final race condition checks
      const itemsWithOriginalQty = itemsToInsert.map((item) => ({
        ...item,
        itemId: String(item.itemId).trim().toUpperCase(),
        originalQuantity: item.quantity,
        status: "Available",
      }));

      const finalNormalizedItemIds = itemsWithOriginalQty.map(
        (item) => item.itemId,
      );
      const allItemsFinal = await Model.find({});
      const finalCheck = [];

      for (const normalizedId of finalNormalizedItemIds) {
        const match = allItemsFinal.find(
          (item) => String(item.itemId).trim().toUpperCase() === normalizedId,
        );
        if (match) {
          finalCheck.push(match);
        }
      }

      if (finalCheck.length > 0) {
        const duplicates = finalCheck.map((item) => item.itemId);
        const modelName = Model.modelName || "Inventory";
        const duplicateList =
          duplicates.length <= 5
            ? duplicates.join(", ")
            : `${duplicates.slice(0, 5).join(", ")} and ${duplicates.length - 5} more`;

        console.log(`[${modelName}] Race condition detected:`, duplicates);
        return res.status(409).json({
          message: `The following Item ID(s) already exist in this inventory table: ${duplicateList}. Each Item ID must be unique within the same inventory table (case-insensitive).`,
        });
      }

      const savedItems = await Model.insertMany(itemsWithOriginalQty, {
        ordered: true,
      });
      const firstId = savedItems[0].itemId;
      const lastId = savedItems[savedItems.length - 1].itemId;
      const logDetail =
        savedItems.length > 1
          ? `Created ${savedItems.length} items (${firstId} to ${lastId})`
          : `Created item '${savedItems[0].name}' (ID: ${firstId})`;

      await logAdminAction(req, "Create Item(s)", logDetail);

      const historyLogs = savedItems.map((item) => ({
        itemId: item.itemId,
        action: "Created",
      }));
      await ItemHistory.insertMany(historyLogs);

      broadcastRefresh();
      res.status(201).json(savedItems);
    } catch (e) {
      console.error("Error adding item(s) to inventory:", e);
      if (
        e.code === 11000 ||
        (e.writeErrors && e.writeErrors.some((err) => err.code === 11000))
      ) {
        const duplicateKey =
          e.keyValue?.itemId ||
          e.writeErrors?.[0]?.keyValue?.itemId ||
          "unknown";
        return res.status(409).json({
          message: `Duplicate Item ID detected: "${duplicateKey}". The Item ID already exists in this inventory table (case-insensitive).`,
        });
      }
      res
        .status(500)
        .json({
          message:
            "Error adding item. Please check server console for details.",
        });
    }
  });

  // PUT update item properties
  router.put(`${apiPath}/:itemId`, isAdmin, async (req, res) => {
    try {
      const item = await Model.findOne({ itemId: req.params.itemId });
      if (!item) return res.status(404).json({ message: "Item not found." });

      const updateData = { ...req.body };

      // Handle quantity adjustments
      if (updateData.originalQuantity !== undefined) {
        const newTotal = parseInt(updateData.originalQuantity);
        updateData.originalQuantity = newTotal;

        const activeLoans = await ItemRequest.find({
          itemId: item.itemId,
          status: "Approved",
        });
        const borrowedQty = activeLoans.reduce(
          (sum, req) => sum + req.quantity,
          0,
        );
        updateData.quantity = newTotal - borrowedQty;
      }

      // Handle status modifications
      if (updateData.status && updateData.status !== item.status) {
        if (
          updateData.status === "Available" &&
          ["Maintenance", "Damaged", "Calibration"].includes(item.status)
        ) {
          const activeLoans = await ItemRequest.find({
            itemId: item.itemId,
            status: "Approved",
          });
          const borrowedQty = activeLoans.reduce(
            (sum, r) => sum + r.quantity,
            0,
          );
          updateData.quantity =
            (item.originalQuantity || item.quantity) - borrowedQty;
        } else if (
          ["Maintenance", "Damaged", "Calibration"].includes(updateData.status)
        ) {
          updateData.quantity = 0;
        }
      }

      const updated = await Model.findOneAndUpdate(
        { itemId: req.params.itemId },
        { $set: updateData },
        { new: true },
      );

      await logAdminAction(
        req,
        "Update Item",
        `Updated item '${updated.name}' (ID: ${updated.itemId})`,
      );
      broadcastRefresh();
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: "Error updating item." });
    }
  });

  // DELETE soft-delete (archive)
  router.delete(`${apiPath}/:itemId`, isAdmin, async (req, res) => {
    try {
      const deleted = await Model.findOneAndUpdate(
        { itemId: req.params.itemId },
        { $set: { status: "Decommissioned", quantity: 0 } },
        { new: true },
      );

      if (!deleted) return res.status(404).json({ message: "Item not found." });

      await logAdminAction(
        req,
        "Archive Item",
        `Archived item '${deleted.name}' (ID: ${deleted.itemId})`,
      );
      broadcastRefresh();
      res.json({ message: "Item archived." });
    } catch (e) {
      res.status(500).json({ message: "Error archiving item." });
    }
  });
};

// Mount 8 standard CRUD configurations
createCrudRoutes("/api/inventory", Inventory);
createCrudRoutes("/api/inventory2", ScienceInventory);
createCrudRoutes("/api/inventory3", SportsInventory);
createCrudRoutes("/api/inventory4", FurnitureInventory);
createCrudRoutes("/api/inventory5", ComputerInventory);
createCrudRoutes("/api/inventory6", FoodLabInventory);
createCrudRoutes("/api/inventory7", RoboticsInventory);
createCrudRoutes("/api/inventory8", MusicInventory);

// GET archived-inventory (decommissioned assets scoped by admin categories)
router.get("/api/archived-inventory", isAdmin, async (req, res) => {
  try {
    const adminUsername = req.session.user.username.toLowerCase();
    const allowedCategories = adminCategoryMapping[adminUsername];
    if (!allowedCategories) return res.json([]);

    let allArchived = [];
    for (const Model of allInventoryModels) {
      const items = await Model.find({
        category: { $in: allowedCategories },
        status: "Decommissioned",
      });
      allArchived = allArchived.concat(items);
    }
    res.json(allArchived);
  } catch (e) {
    res.status(500).json({ message: "Error fetching archived inventory." });
  }
});

// PUT restore item from archive
router.put("/api/inventory/restore/:itemId", isAdmin, async (req, res) => {
  try {
    const { item } = await findModelAndItemForAdmin(
      req.params.itemId,
      req.session.user.username,
    );
    if (!item) {
      return res
        .status(404)
        .json({ message: "Item not found in your categories." });
    }

    item.status = "Available";
    item.quantity = item.originalQuantity;
    await item.save();

    await logAdminAction(
      req,
      "Restore Item",
      `Restored item '${item.name}' from archive.`,
    );
    broadcastRefresh();
    res.json({ message: "Item restored successfully." });
  } catch (e) {
    res.status(500).json({ message: "Error restoring item." });
  }
});

// DELETE permanently delete item from DB
router.delete("/api/inventory/permanent/:itemId", isAdmin, async (req, res) => {
  try {
    const { item, Model } = await findModelAndItemForAdmin(
      req.params.itemId,
      req.session.user.username,
    );
    if (!item) {
      return res
        .status(404)
        .json({ message: "Item not found in your categories." });
    }

    await Model.deleteOne({ itemId: req.params.itemId });

    // Cascading delete
    await ItemRequest.deleteMany({ itemId: req.params.itemId });
    await ItemHistory.deleteMany({ itemId: req.params.itemId });
    await Incident.deleteMany({ "damagedItemInfo.itemId": req.params.itemId });

    await logAdminAction(
      req,
      "Permanent Delete",
      `PERMANENTLY DELETED item '${item.name}' (ID: ${item.itemId}) and all related data.`,
    );

    broadcastRefresh();
    res.json({ message: "Item permanently deleted." });
  } catch (e) {
    res.status(500).json({ message: "Error permanently deleting item." });
  }
});

// GET all-inventory (for student search pane)
router.get("/api/all-inventory", isAuthenticated, async (req, res) => {
  try {
    const findCriteria = { status: "Available" };
    const inventories = await Promise.all(
      allInventoryModels.map((model) => model.find(findCriteria)),
    );
    res.json([].concat(...inventories));
  } catch (e) {
    res.status(500).json({ message: "Error fetching all inventories." });
  }
});

module.exports = router;
