const History = require("../models/History");
const User = require("../models/User");
const ItemRequest = require("../models/ItemRequest");
const Incident = require("../models/Incident");
const { allInventoryModels, Inventory } = require("../models/Inventory");
const {
  adminCategoryMapping,
  categoryAdminMap,
} = require("../config/constants");
const { broadcastRefresh } = require("../utils/websocket");

const Notification = require("../models/Notification");

const logAdminAction = async (req, action, details) => {
  try {
    if (!req.session.user || req.session.user.role !== "admin") return;
    const newLog = new History({
      adminUsername: req.session.user.username,
      action,
      details,
    });
    await newLog.save();
  } catch (error) {
    console.error(`History log failed: ${error.message}`);
  }
};

const checkStockAndNotify = async (item) => {
  if (item && item.quantity === 0 && item.status === "Available") {
    const adminUsername = categoryAdminMap[item.category];
    if (adminUsername) {
      const targetAdmin = await User.findOne({ username: adminUsername });
      if (targetAdmin) {
        const lowStockNotification = new Notification({
          userId: targetAdmin._id,
          title: "Inventory Alert: Item Out of Stock",
          message: `The item "${item.name}" (ID: ${item.itemId}) is now out of stock.`,
        });
        await lowStockNotification.save();
      }
    }
  }
};

const findModelAndItemForAdmin = async (itemId, adminUsername) => {
  const allowedCategories = adminCategoryMapping[adminUsername.toLowerCase()];
  if (!allowedCategories) return { item: null, Model: null };

  for (const Model of allInventoryModels) {
    const item = await Model.findOne({ itemId });
    if (item && allowedCategories.includes(item.category)) {
      return { item, Model };
    }
  }
  return { item: null, Model: null };
};

const findAndUpdateItemForAdmin = async (itemId, change, adminUsername) => {
  const { item, Model } = await findModelAndItemForAdmin(itemId, adminUsername);
  if (!item) return null;

  if (typeof item.originalQuantity === "undefined") {
    item.originalQuantity = item.quantity;
  }
  item.quantity += change;

  // Logic to prevent quantity from exceeding original on return
  if (change > 0 && item.quantity > item.originalQuantity) {
    item.quantity = item.originalQuantity;
  }

  // Status update logic
  if (item.status === "In-Use" && item.quantity > 0) {
    item.status = "Available";
  } else if (item.status === "Available" && item.quantity === 0) {
    item.status = "In-Use";
  }

  await item.save();
  return item;
};

const findItemInAllowedCategory = async (itemId, adminUsername) => {
  const { item } = await findModelAndItemForAdmin(itemId, adminUsername);
  return item;
};

const extractBaseId = (itemId) => {
  if (!itemId) return null;
  const match = String(itemId).match(/^(.+?)(-\d+)?$/);
  return match ? match[1] : itemId;
};

const isItemAvailableForRequest = async (itemId, studentId) => {
  const existingRequestForStudent = await ItemRequest.findOne({
    studentId,
    itemId,
    status: { $in: ["Pending", "Approved"] },
  });
  if (existingRequestForStudent) return false;

  const existingRequestForOthers = await ItemRequest.findOne({
    itemId,
    status: { $in: ["Pending", "Approved"] },
  });
  if (existingRequestForOthers) return false;

  return true;
};

const findAvailableItemsInGroup = async (
  baseId,
  itemName,
  category,
  requestedQuantity,
  studentId,
) => {
  const availableItems = [];

  for (const Model of allInventoryModels) {
    const allItemsInGroup = await Model.find({
      itemId: {
        $regex: new RegExp(
          `^${baseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`,
          "i",
        ),
      },
      name: itemName,
      category: category,
      status: "Available",
    }).sort({ itemId: 1 });

    for (const item of allItemsInGroup) {
      if (
        item.quantity > 0 &&
        (await isItemAvailableForRequest(item.itemId, studentId))
      ) {
        availableItems.push({
          itemId: item.itemId,
          itemName: item.name,
          category: item.category,
          Model: Model,
        });
        if (availableItems.length >= requestedQuantity) break;
      }
    }

    if (availableItems.length >= requestedQuantity) break;
  }

  if (availableItems.length < requestedQuantity) {
    for (const Model of allInventoryModels) {
      const exactMatchItem = await Model.findOne({
        itemId: baseId,
        name: itemName,
        category: category,
        status: "Available",
      });

      if (
        exactMatchItem &&
        exactMatchItem.quantity > 0 &&
        (await isItemAvailableForRequest(exactMatchItem.itemId, studentId))
      ) {
        if (
          !availableItems.some((item) => item.itemId === exactMatchItem.itemId)
        ) {
          availableItems.push({
            itemId: exactMatchItem.itemId,
            itemName: exactMatchItem.name,
            category: exactMatchItem.category,
            Model: Model,
          });
          if (availableItems.length >= requestedQuantity) break;
        }
      }
    }
  }

  return availableItems;
};

module.exports = {
  logAdminAction,
  checkStockAndNotify,
  findModelAndItemForAdmin,
  findAndUpdateItemForAdmin,
  findItemInAllowedCategory,
  extractBaseId,
  isItemAvailableForRequest,
  findAvailableItemsInGroup,
};
