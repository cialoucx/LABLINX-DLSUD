const categoryAdminMap = {
  General: "admin",
  "Office Supplies": "admin",
  Science: "admin2",
  Sports: "admin2",
  "Tables & Chairs": "admin3",
  "Computer Lab": "admin3",
  "Food Lab": "admin3",
  "Music Instruments": "admin3",
  Robotics: "admin4",
};

const adminCategoryMapping = {
  admin: ["General", "Office Supplies"],
  admin2: ["Science", "Sports"],
  admin3: ["Tables & Chairs", "Computer Lab", "Food Lab", "Music Instruments"],
  admin4: ["Robotics"],
};

const DEFAULT_SYSTEM_SETTINGS = {
  borrowing_limit: 5,
  max_borrow_days: 14,
  reservation_max_days: 7,
  reservation_daily_rate: 0,
  replacement_return_days: 7,
};

// Lazy initialization of ALLOWED_EMAIL_DOMAINS to ensure env is loaded first
const getAllowedEmailDomains = () => {
  return (process.env.ALLOWED_DOMAIN || "@dlsud.edu.ph,@hs.dlsud.edu.ph")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
};

const isEmailDomainAllowed = (email) => {
  if (!email) return false;
  const normalizedEmail = email.toLowerCase();
  const domains = getAllowedEmailDomains();
  return domains.some((domain) => normalizedEmail.endsWith(domain));
};

module.exports = {
  categoryAdminMap,
  adminCategoryMapping,
  DEFAULT_SYSTEM_SETTINGS,
  getAllowedEmailDomains,
  isEmailDomainAllowed,
};
