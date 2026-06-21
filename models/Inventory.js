const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    originalQuantity: { type: Number, required: true, min: 0 },
    location: { type: String, required: true },
    price: { type: Number, required: false, default: 0 },
    status: {
      type: String,
      enum: [
        "Available",
        "In-Use",
        "Maintenance",
        "Damaged",
        "Calibration",
        "Decommissioned",
      ],
      default: "Available",
    },
  },
  { timestamps: true },
);

const Inventory = mongoose.model("Inventory", inventorySchema, "inventories");
const ScienceInventory = mongoose.model(
  "ScienceInventory",
  inventorySchema,
  "science_inventories",
);
const SportsInventory = mongoose.model(
  "SportsInventory",
  inventorySchema,
  "sports_inventories",
);
const FurnitureInventory = mongoose.model(
  "FurnitureInventory",
  inventorySchema,
  "furniture_inventories",
);
const ComputerInventory = mongoose.model(
  "ComputerInventory",
  inventorySchema,
  "computer_inventories",
);
const FoodLabInventory = mongoose.model(
  "FoodLabInventory",
  inventorySchema,
  "food_lab_inventories",
);
const RoboticsInventory = mongoose.model(
  "RoboticsInventory",
  inventorySchema,
  "robotics_inventories",
);
const MusicInventory = mongoose.model(
  "MusicInventory",
  inventorySchema,
  "music_inventories",
);

const allInventoryModels = [
  Inventory,
  ScienceInventory,
  SportsInventory,
  FurnitureInventory,
  ComputerInventory,
  FoodLabInventory,
  RoboticsInventory,
  MusicInventory,
];

module.exports = {
  Inventory,
  ScienceInventory,
  SportsInventory,
  FurnitureInventory,
  ComputerInventory,
  FoodLabInventory,
  RoboticsInventory,
  MusicInventory,
  allInventoryModels,
};
