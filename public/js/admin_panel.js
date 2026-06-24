// Unified Dynamic Admin Dashboard Controller
document.addEventListener("DOMContentLoaded", () => {
  // --- 1. MAPPINGS & CONFIGURATION ---
  const adminCategoryMapping = {
    admin: ["General", "Office Supplies"],
    admin2: ["Science", "Sports"],
    admin3: [
      "Tables & Chairs",
      "Computer Lab",
      "Food Lab",
      "Music Instruments",
    ],
    admin4: ["Robotics"],
  };

  const categoryEndpointMapping = {
    General: "/api/inventory",
    "Office Supplies": "/api/inventory",
    Science: "/api/inventory2",
    Sports: "/api/inventory3",
    "Tables & Chairs": "/api/inventory4",
    "Computer Lab": "/api/inventory5",
    "Food Lab": "/api/inventory6",
    Robotics: "/api/inventory7",
    "Music Instruments": "/api/inventory8",
  };

  const apiBaseUrl = window.location.origin;
  const originalFetch = window.fetch.bind(window);

  // Intercept fetch requests to resolve absolute URLs
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/")) {
      return originalFetch(`${apiBaseUrl}${input}`, init);
    }
    if (
      input &&
      typeof input === "object" &&
      "url" in input &&
      input.url.startsWith("/")
    ) {
      const clonedRequest = new Request(`${apiBaseUrl}${input.url}`, input);
      return originalFetch(clonedRequest, init);
    }
    return originalFetch(input, init);
  };

  // --- 2. GLOBAL STATE ---
  let currentUser = null;
  let allowedCategories = [];
  let ACTIVE_INVENTORY_TYPE = null;
  let currentStore = [];
  let allRequestsData = [];
  let allUsersData = [];
  let allHistoryLogs = [];
  let notifications = [];
  let selectedArchivedItems = [];

  let isViewingInventoryArchive = false;
  let isViewingTrash = false;

  let currentBorrowingStudentId = null;
  let scannedEquipmentId = null;
  let scanDebounceTimer = null;

  let requestStatusBarChartInstance = null;
  let inventoryPieChartInstance = null;

  // Cache DOM element selectors
  const body = document.body;
  const logoutLink = document.querySelector(".logout-link");
  if (logoutLink) {
    logoutLink.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = `${apiBaseUrl}/logout`;
    });
  }

  const editModal = document.getElementById("editModal");
  const statusEditModal = document.getElementById("statusEditModal");
  const editForm = document.getElementById("editForm");
  const requestsTableBody = document.getElementById("requestsTableBody");
  const notificationList = document.getElementById("notification-list");
  const notificationBadge = document.getElementById("notification-badge");
  const requestSearch = document.getElementById("requestSearch");
  const requestStatusFilter = document.getElementById("requestStatusFilter");
  const toggleTrashViewBtn = document.getElementById("toggleTrashViewBtn");
  const requestsTitle = document.getElementById("requests-title");
  const logo = document.querySelector(".logo img");

  // Live Scan elements
  const scanForm = document.getElementById("scanForm");
  const scanMode = document.getElementById("scanMode");
  const scanStatus = document.getElementById("scanStatus");
  const trackingDetailsContainer = document.getElementById(
    "trackingDetailsContainer",
  );
  const autoSubmitCheck = document.getElementById("autoSubmitCheck");
  const studentIdInput = document.getElementById("studentIdInput");
  const itemIdInput = document.getElementById("itemIdInput");
  const studentIdGroup = document.getElementById("studentIdGroup");
  const itemIdGroup = document.getElementById("itemIdGroup");
  const scanAnotherItemBtn = document.getElementById("scanAnotherItemBtn");
  const cancelScanBtn = document.getElementById("cancelScanBtn");
  const updateStatusBtn = document.getElementById("updateStatusBtn");

  // History/Reports elements
  const historyActionFilter = document.getElementById("historyActionFilter");
  const reportTypeSelect = document.getElementById("reportType");
  const generateReportBtn = document.getElementById("generateReportBtn");
  const reportResult = document.getElementById("reportResult");
  const printReportBtn = document.getElementById("printReportBtn");
  let selectedPeriod = "daily";

  // --- 3. INITIALIZATION ---
  const initializeApp = async () => {
    try {
      // Fetch user context
      const userRes = await fetch("/api/current-user");
      if (!userRes.ok) {
        window.location.href = "/login";
        return;
      }
      currentUser = await userRes.json();

      const welcomeDateEl = document.getElementById("welcomeDate");
      if (welcomeDateEl) {
        const now = new Date();
        welcomeDateEl.textContent = now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      }

      // Configure Allowed Categories & API Endpoint Mapping
      const usernameLower = currentUser.username.toLowerCase();
      allowedCategories = adminCategoryMapping[usernameLower] || [];

      // Guard: if this user has no admin category mapping (e.g. stale session
      // from a student/faculty account), redirect to login.
      if (allowedCategories.length === 0) {
        window.location.href = "/login";
        return;
      }

      ACTIVE_INVENTORY_TYPE = allowedCategories[0];

      // Dynamic Menu Rendering for Super Admin
      const isSuperAdmin = usernameLower === "admin2";
      if (isSuperAdmin) {
        document.querySelectorAll(".superadmin-only").forEach((el) => {
          el.style.display = el.tagName === "A" ? "flex" : "block";
        });
      } else {
        document.querySelectorAll(".superadmin-only").forEach((el) => {
          el.style.display = "none";
        });
      }

      // Build Inventory Dropdown and Category sub-tabs
      populateCategorySelect();
      renderCategoryTabs();
      setupEventListeners();
      connectWebSocket();

      // Load home dashboard
      window.showPage("dashboard");
      fetchAdminNotifications();
    } catch (err) {
      console.error("App initialization error:", err);
      showToast("Error loading application profile.", "error");
    }
  };

  const populateCategorySelect = () => {
    const select = document.getElementById("inventoryCategorySelect");
    if (!select) return;
    select.innerHTML = "";
    allowedCategories.forEach((category) => {
      const opt = document.createElement("option");
      opt.value = category;
      opt.textContent = category;
      select.appendChild(opt);
    });
  };

  const renderCategoryTabs = () => {
    const container = document.getElementById("inventoryCategoryTabs");
    if (!container) return;
    container.innerHTML = "";

    if (allowedCategories.length <= 1) {
      container.style.display = "none";
      return;
    }

    container.style.display = "flex";
    allowedCategories.forEach((category) => {
      const btn = document.createElement("button");
      btn.className = `tab-button ${category === ACTIVE_INVENTORY_TYPE ? "active" : ""}`;
      btn.textContent = `${category} Inventory`;
      btn.addEventListener("click", () => {
        document
          .querySelectorAll("#inventoryCategoryTabs .tab-button")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        ACTIVE_INVENTORY_TYPE = category;
        document.getElementById("inventoryTableTitle").textContent =
          `${category} Equipment`;
        isViewingInventoryArchive = false;
        document.getElementById("toggleInventoryArchiveBtn").textContent =
          "View Archives";
        fetchInventory();
      });
      container.appendChild(btn);
    });
  };

  // Resolve requests endpoint dynamically based on username
  const getRequestsEndpoint = () => {
    const username = currentUser.username.toLowerCase();
    if (username === "admin2") return "/api/admin2-requests";
    if (username === "admin3") return "/api/admin3-requests";
    if (username === "admin4") return "/api/admin-requests/Robotics";
    return "/api/admin-requests";
  };

  // --- 4. REALTIME WEBSOCKET ---
  function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsHost = window.location.host;
    const ws = new WebSocket(`${protocol}://${wsHost}`);

    ws.onopen = () => console.log("WebSocket Connected");
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "refresh") {
          console.log("Real-time refresh signal received");
          showToast("Data refreshed in real-time.");
          const activePage = document.querySelector(".page-content.active");
          if (activePage) {
            const pageId = activePage.id.replace("-content", "");
            switch (pageId) {
              case "dashboard":
                updateDashboard();
                break;
              case "inventory":
                if (isViewingInventoryArchive) fetchArchivedInventory();
                else fetchInventory();
                break;
              case "requests":
                if (isViewingTrash) fetchDeletedRequests();
                else fetchAllRequests();
                break;
              case "notifications":
                fetchAdminNotifications();
                break;
              case "history":
                fetchHistoryLogs();
                break;
              case "super-admin":
                loadSuperAdminData();
                break;
              case "user-management":
                fetchAllUsers();
                break;
              case "profile-requests":
                fetchProfileUpdateRequests();
                break;
              case "registration-requests":
                fetchPendingRegistrations();
                break;
              case "incident-reports":
                fetchIncidentReports();
                break;
              case "settings":
                fetchSettings();
                break;
            }
          }
          // Always update badge
          if (
            !document
              .getElementById("notifications-content")
              .classList.contains("active")
          ) {
            fetchAdminNotifications();
          }
        }
      } catch (e) {
        console.error("Error processing WS message:", e);
      }
    };
    ws.onclose = () => {
      console.log("WebSocket Disconnected. Reconnecting in 3s...");
      setTimeout(connectWebSocket, 3000);
    };
    ws.onerror = (err) => {
      console.error("WebSocket Error:", err);
      ws.close();
    };
  }

  // --- 5. EVENT LISTENERS ---
  const setupEventListeners = () => {
    document
      .querySelector(".toggle-btn")
      .addEventListener("click", () =>
        body.classList.toggle("sidebar-collapsed"),
      );

    const darkToggle = document.querySelector(".dark-toggle");
    darkToggle.addEventListener("click", () => {
      body.classList.toggle("dark");
      const isDarkMode = body.classList.contains("dark");
      localStorage.setItem("dark-mode", isDarkMode);
      darkToggle.querySelector(".sun-icon").style.display = isDarkMode
        ? "none"
        : "block";
      darkToggle.querySelector(".moon-icon").style.display = isDarkMode
        ? "block"
        : "none";
      if (
        document
          .getElementById("dashboard-content")
          .classList.contains("active")
      ) {
        updateDashboard();
      }
    });

    if (localStorage.getItem("dark-mode") === "true") {
      body.classList.add("dark");
      darkToggle.querySelector(".sun-icon").style.display = "none";
      darkToggle.querySelector(".moon-icon").style.display = "block";
    }

    // Sidebar navigation Click delegator
    const sidebarNav = document.querySelector("#sidebar nav");
    if (sidebarNav) {
      sidebarNav.addEventListener(
        "click",
        (e) => {
          const link = e.target.closest("a[data-page]");
          if (link) {
            e.preventDefault();
            e.stopPropagation();
            const pageId = link.getAttribute("data-page");
            if (pageId) window.showPage(pageId);
          }
        },
        true,
      );
    }

    // Inventory page listeners
    const addForm = document.getElementById("addFormInventory");
    if (addForm) addForm.addEventListener("submit", handleAddItem);

    const searchInv = document.getElementById("searchInventory");
    if (searchInv) searchInv.addEventListener("input", renderInventoryTable);

    const filterStatus = document.getElementById("inventoryStatusFilter");
    if (filterStatus)
      filterStatus.addEventListener("change", renderInventoryTable);

    const toggleArchBtn = document.getElementById("toggleInventoryArchiveBtn");
    if (toggleArchBtn)
      toggleArchBtn.addEventListener("click", toggleInventoryArchiveView);

    editForm.addEventListener("submit", handleUpdateItem);
    editModal.querySelector(".close-button").onclick = () =>
      (editModal.style.display = "none");
    statusEditModal.querySelector(".close-button").onclick = () =>
      (statusEditModal.style.display = "none");

    logo.addEventListener("click", () => window.showPage("dashboard"));

    // Requests Page listeners
    requestSearch.addEventListener("input", renderRequestsTable);
    requestStatusFilter.addEventListener("change", renderRequestsTable);
    toggleTrashViewBtn.addEventListener("click", toggleRequestView);

    document
      .getElementById("statusEditForm")
      .addEventListener("submit", (e) => {
        e.preventDefault();
        const requestId = document.getElementById("statusRequestId").value;
        const newStatus = document.getElementById("statusSelect").value;
        handleRequest(requestId, newStatus);
        statusEditModal.style.display = "none";
      });

    document.getElementById("closeViewRequestDetailsModal").onclick = () =>
      closeViewRequestDetailsModal();
    document.getElementById("closeReturnConditionModal").onclick = () =>
      (document.getElementById("returnConditionModal").style.display = "none");
    document
      .getElementById("returnConditionForm")
      .addEventListener("submit", handleReturnConditionSubmission);

    document
      .getElementById("conditionSelect")
      .addEventListener("change", (e) => {
        const notesLabel = document.getElementById("damageNotesLabel");
        const notesTextarea = document.getElementById("damageNotes");
        if (["Damaged", "Lost"].includes(e.target.value)) {
          notesLabel.style.display = "block";
          notesTextarea.style.display = "block";
          notesTextarea.required = true;
        } else {
          notesLabel.style.display = "none";
          notesTextarea.style.display = "none";
          notesTextarea.required = false;
        }
      });

    // History & Reports listeners
    historyActionFilter.addEventListener("change", renderHistoryLogs);

    const periodBtns = document.querySelectorAll(".period-btn");
    periodBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        periodBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        selectedPeriod = btn.id.replace("Btn", "");
      });
    });
    generateReportBtn.addEventListener("click", handleGenerateReport);
    printReportBtn.addEventListener("click", handlePrintReport);

    // Super Admin Listeners (User Management)
    const addUserForm = document.getElementById("addUserForm");
    if (addUserForm) addUserForm.addEventListener("submit", handleCreateUser);

    const searchUsersInput = document.getElementById("searchUsers");
    if (searchUsersInput)
      searchUsersInput.addEventListener("input", renderUsersTable);

    const toggleUserArchiveBtn = document.getElementById(
      "toggleUserArchiveBtn",
    );
    if (toggleUserArchiveBtn)
      toggleUserArchiveBtn.addEventListener("click", toggleUserArchiveView);

    window.onclick = (event) => {
      if (event.target == editModal) editModal.style.display = "none";
      if (event.target == statusEditModal)
        statusEditModal.style.display = "none";
      if (event.target == document.getElementById("returnConditionModal"))
        document.getElementById("returnConditionModal").style.display = "none";
      if (event.target == document.getElementById("viewRequestDetailsModal"))
        closeViewRequestDetailsModal();
    };

    // Live scan listeners
    scanMode.addEventListener("change", resetScannerUI);
    scanForm.addEventListener("submit", (e) => {
      e.preventDefault();
      processScan(document.activeElement);
    });
    enableAutoSubmit();
    scanAnotherItemBtn.addEventListener("click", scanAnotherItem);
    cancelScanBtn.addEventListener("click", cancelTransaction);
    updateStatusBtn.addEventListener("click", updateEquipmentStatus);

    const mainContentArea = document.querySelector("main");
    mainContentArea.addEventListener("click", (event) => {
      const liveScanPage = document.getElementById("live-scan-content");
      if (
        liveScanPage.classList.contains("active") &&
        !event.target.closest(
          ".live-scan-container form, .live-scan-container select, .scan-action-buttons",
        )
      ) {
        if (itemIdGroup.style.display !== "none") {
          itemIdInput.focus();
        } else if (studentIdGroup.style.display !== "none") {
          studentIdInput.focus();
        }
      }
    });

    // Super Admin static inventory monitoring filters
    const filterS1 = document.getElementById("superAdmin2ScienceStatusFilter");
    if (filterS1) {
      filterS1.addEventListener("change", () => {
        renderSuperAdminInventoryTable(
          superAdmin2ScienceData,
          document
            .getElementById("tableAdmin2ScienceInventory")
            .querySelector("tbody"),
          filterS1.value,
        );
      });
    }
    const filterS2 = document.getElementById("superAdmin2SportsStatusFilter");
    if (filterS2) {
      filterS2.addEventListener("change", () => {
        renderSuperAdminInventoryTable(
          superAdmin2SportsData,
          document
            .getElementById("tableAdmin2SportsInventory")
            .querySelector("tbody"),
          filterS2.value,
        );
      });
    }
    const filterS3 = document.getElementById("superAdmin3StatusFilter");
    if (filterS3) {
      filterS3.addEventListener("change", () => {
        renderSuperAdminInventoryTable(
          superAdmin3InventoryData,
          document
            .getElementById("tableAdmin3Inventory")
            .querySelector("tbody"),
          filterS3.value,
        );
      });
    }
    const filterS4 = document.getElementById("superAdmin4StatusFilter");
    if (filterS4) {
      filterS4.addEventListener("change", () => {
        renderSuperAdminInventoryTable(
          superAdmin4InventoryData,
          document
            .getElementById("tableAdmin4Inventory")
            .querySelector("tbody"),
          filterS4.value,
        );
      });
    }
  };

  const handleAutoSubmit = (event) => {
    clearTimeout(scanDebounceTimer);
    if (autoSubmitCheck.checked) {
      scanDebounceTimer = setTimeout(() => {
        if (event.target.value.trim() !== "") {
          processScan(event.target);
        }
      }, 100);
    }
  };

  const disableAutoSubmit = () => {
    itemIdInput.removeEventListener("input", handleAutoSubmit);
    studentIdInput.removeEventListener("input", handleAutoSubmit);
  };

  const enableAutoSubmit = () => {
    itemIdInput.addEventListener("input", handleAutoSubmit);
    studentIdInput.addEventListener("input", handleAutoSubmit);
  };

  // --- 6. PAGE ROUTING CONTROLLER ---
  const pageNames = {
    dashboard: "Dashboard",
    "live-scan": "Live Scan",
    inventory: "Inventory",
    requests: "Requests",
    notifications: "Notifications",
    history: "History",
    reports: "Reports",
    reservations: "Reservations",
    settings: "Settings",
    "super-admin": "Super Admin Oversight",
    "user-management": "User Accounts",
    "profile-requests": "Profile Approvals",
    "registration-requests": "Pending Registrations",
    "incident-reports": "Incident Reports",
  };

  window.showPage = (pageId) => {
    if (!pageId) return;

    document
      .querySelectorAll(".page-content")
      .forEach((p) => p.classList.remove("active"));
    const targetPage = document.getElementById(`${pageId}-content`);
    if (targetPage) targetPage.classList.add("active");

    document.querySelectorAll("#sidebar nav a[data-page]").forEach((l) => {
      l.classList.toggle("active", l.dataset.page === pageId);
    });

    const breadcrumbPage = document.getElementById("breadcrumb-page");
    if (breadcrumbPage)
      breadcrumbPage.textContent = pageNames[pageId] || pageId;

    if (pageId === "dashboard") updateDashboard();
    else if (pageId === "inventory") {
      isViewingInventoryArchive = false;
      document.getElementById("toggleInventoryArchiveBtn").textContent =
        "View Archives";
      document.getElementById("inventoryTableTitle").textContent =
        `${ACTIVE_INVENTORY_TYPE} Equipment`;
      fetchInventory();
    } else if (pageId === "requests") {
      isViewingTrash = false;
      fetchAllRequests();
    } else if (pageId === "notifications") {
      renderNotifications();
    } else if (pageId === "history") {
      fetchHistoryLogs();
    } else if (pageId === "live-scan") {
      initializeLiveScan();
    } else if (pageId === "super-admin") {
      loadSuperAdminData();
    } else if (pageId === "user-management") {
      fetchAllUsers();
    } else if (pageId === "profile-requests") {
      fetchProfileUpdateRequests();
    } else if (pageId === "registration-requests") {
      fetchPendingRegistrations();
    } else if (pageId === "incident-reports") {
      fetchIncidentReports();
    } else if (pageId === "settings") {
      fetchSettings();
    }
  };

  // --- 7. DASHBOARD LOGIC ---
  const updateDashboard = async () => {
    try {
      const isSuperAdmin = currentUser.username.toLowerCase() === "admin2";

      if (isSuperAdmin) {
        document.getElementById("superAdminDashboardGrid").style.display =
          "grid";
        document.getElementById("standardDashboardGrid").style.display = "none";
        await updateSuperAdminDashboard();
      } else {
        document.getElementById("superAdminDashboardGrid").style.display =
          "none";
        document.getElementById("standardDashboardGrid").style.display = "grid";
        await updateStandardDashboard();
      }
    } catch (err) {
      console.error("Dashboard loading error:", err);
    }
  };

  const updateStandardDashboard = async () => {
    try {
      const fetchInventoryPromises = allowedCategories.map((cat) =>
        fetch(categoryEndpointMapping[cat]).then((res) => res.json()),
      );
      const requestsRes = await fetch(getRequestsEndpoint());

      const inventories = await Promise.all(fetchInventoryPromises);
      const allItems = [].concat(...inventories);

      const totalEquipment = allItems.reduce(
        (sum, item) => sum + (item.originalQuantity || 0),
        0,
      );
      const availableQty = allItems.reduce(
        (sum, item) => sum + (item.quantity || 0),
        0,
      );
      const borrowedItems = totalEquipment - availableQty;
      const maintenanceItems = allItems.filter(
        (item) => item.status === "Maintenance" || item.status === "Damaged",
      ).length;

      document
        .getElementById("standardTotalCounter")
        .setAttribute("data-target", totalEquipment);
      document
        .getElementById("standardBorrowedCounter")
        .setAttribute("data-target", borrowedItems);
      document
        .getElementById("standardMaintenanceCounter")
        .setAttribute("data-target", maintenanceItems);
      animateCounters();

      if (requestsRes.ok) {
        const requests = await requestsRes.json();
        renderRequestStatusBarChart(requests);
      }
    } catch (error) {
      console.error(error);
      showToast("Error loading dashboard statistics.", "error");
    }
  };

  const updateSuperAdminDashboard = async () => {
    try {
      const [
        admin2InvRes,
        admin3InvRes,
        admin4InvRes,
        admin2ReqRes,
        admin3ReqRes,
        admin4ReqRes,
      ] = await Promise.all([
        Promise.all([fetch("/api/inventory2"), fetch("/api/inventory3")]),
        Promise.all([
          fetch("/api/inventory4"),
          fetch("/api/inventory5"),
          fetch("/api/inventory6"),
          fetch("/api/inventory8"),
        ]),
        fetch("/api/inventory7"),
        fetch("/api/admin2-requests"),
        fetch("/api/admin3-requests"),
        fetch("/api/admin-requests/Robotics"),
      ]);

      const admin2InventoriesJson = await Promise.all(
        admin2InvRes.map((res) => res.json()),
      );
      const admin2Inventories = [].concat(...admin2InventoriesJson);
      const admin3InventoriesJson = await Promise.all(
        admin3InvRes.map((res) => res.json()),
      );
      const admin3Inventories = [].concat(...admin3InventoriesJson);
      const admin4Inventories = await admin4InvRes.json();

      const admin2ScienceTotal = admin2Inventories
        .filter((i) => i.category === "Science")
        .reduce((sum, item) => sum + (item.originalQuantity || 0), 0);
      const admin2SportsTotal = admin2Inventories
        .filter((i) => i.category === "Sports")
        .reduce((sum, item) => sum + (item.originalQuantity || 0), 0);
      const admin3Total = admin3Inventories.reduce(
        (sum, item) => sum + (item.originalQuantity || 0),
        0,
      );
      const admin4Total = admin4Inventories.reduce(
        (sum, item) => sum + (item.originalQuantity || 0),
        0,
      );

      document
        .getElementById("admin2-science-card")
        .setAttribute("data-target", admin2ScienceTotal);
      document
        .getElementById("admin2-sports-card")
        .setAttribute("data-target", admin2SportsTotal);
      document
        .getElementById("admin3-total-card")
        .setAttribute("data-target", admin3Total);
      document
        .getElementById("admin4-total-card")
        .setAttribute("data-target", admin4Total);
      animateCounters();

      const allMonitoredInventories = [
        ...admin2Inventories,
        ...admin3Inventories,
        ...admin4Inventories,
      ];
      renderInventoryPieChart(allMonitoredInventories);

      const allMonitoredRequests = [
        ...(await admin2ReqRes.json()),
        ...(await admin3ReqRes.json()),
        ...(await admin4ReqRes.json()),
      ];
      renderRequestStatusBarChart(allMonitoredRequests);
    } catch (error) {
      console.error(error);
      showToast("Error loading Super Admin oversight metrics.", "error");
    }
  };

  const animateCounters = () => {
    document.querySelectorAll(".counter").forEach((counter) => {
      counter.innerText = "0";
      const update = () => {
        const target = +counter.getAttribute("data-target") || 0;
        const count = +counter.innerText;
        const increment = Math.max(1, Math.ceil((target - count) / 10));
        if (count < target) {
          counter.innerText = `${Math.min(target, count + increment)}`;
          setTimeout(update, 40);
        } else {
          counter.innerText = target;
        }
      };
      update();
    });
  };

  function renderInventoryPieChart(inventories) {
    const ctx = document.getElementById("inventoryPieChart");
    if (!ctx) return;
    const canvasContext = ctx.getContext("2d");
    if (inventoryPieChartInstance) inventoryPieChartInstance.destroy();

    const categoryTotals = inventories.reduce((acc, item) => {
      acc[item.category] =
        (acc[item.category] || 0) + (item.originalQuantity || 0);
      return acc;
    }, {});

    inventoryPieChartInstance = new Chart(canvasContext, {
      type: "doughnut",
      data: {
        labels: Object.keys(categoryTotals),
        datasets: [
          {
            label: "Total Items",
            data: Object.values(categoryTotals),
            backgroundColor: [
              "#3498db",
              "#9b59b6",
              "#f1c40f",
              "#e74c3c",
              "#2ecc71",
              "#34495e",
              "#1abc9c",
              "#e67e22",
            ],
            borderColor: body.classList.contains("dark")
              ? "var(--card-bg-dark)"
              : "var(--card-bg-light)",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: {
              color: body.classList.contains("dark")
                ? "var(--text-light)"
                : "var(--text-dark)",
            },
          },
        },
      },
    });
  }

  function renderRequestStatusBarChart(requests) {
    const ctx = document.getElementById("requestStatusBarChart");
    if (!ctx) return;
    const canvasContext = ctx.getContext("2d");
    if (requestStatusBarChartInstance) requestStatusBarChartInstance.destroy();

    const statusCounts = requests.reduce((acc, req) => {
      acc[req.status] = (acc[req.status] || 0) + 1;
      return acc;
    }, {});

    const labels = ["Pending", "Approved", "Rejected", "Returned"];
    const data = labels.map((label) => statusCounts[label] || 0);
    const textColor = body.classList.contains("dark")
      ? "var(--text-light)"
      : "var(--text-dark)";

    requestStatusBarChartInstance = new Chart(canvasContext, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Number of Requests",
            data: data,
            backgroundColor: [
              "rgba(240, 173, 78, 0.8)",
              "rgba(40, 167, 69, 0.8)",
              "rgba(220, 53, 69, 0.8)",
              "rgba(108, 117, 125, 0.8)",
            ],
            borderColor: ["#f0ad4e", "#28a745", "#dc3545", "#6c757d"],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: textColor },
          },
          x: {
            ticks: { color: textColor },
          },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  // --- 8. INVENTORY MANAGEMENT ---
  const fetchInventory = async () => {
    if (!ACTIVE_INVENTORY_TYPE) return;
    const api = categoryEndpointMapping[ACTIVE_INVENTORY_TYPE];
    try {
      const res = await fetch(api);
      if (!res.ok) throw new Error();
      currentStore = await res.json();
      renderInventoryTable();
    } catch (e) {
      showToast(`Error fetching ${ACTIVE_INVENTORY_TYPE} inventory.`, "error");
    }
  };

  const renderInventoryTable = () => {
    const query = document
      .getElementById("searchInventory")
      .value.trim()
      .toLowerCase();
    const status = document.getElementById("inventoryStatusFilter").value;
    const tbody = document.getElementById("inventoryTableBody");
    tbody.innerHTML = "";

    let items = currentStore;
    if (status !== "All") {
      items = items.filter((i) => i.status === status);
    }
    if (query !== "") {
      items = items.filter(
        (i) =>
          String(i.itemId).toLowerCase().includes(query) ||
          String(i.name).toLowerCase().includes(query),
      );
    }

    if (items.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="10" style="text-align: center;">No equipment found.</td></tr>';
      return;
    }

    // Sort by numeric sequence in itemId for clean alignment
    items.sort((a, b) => {
      const aNum = parseInt(a.itemId.split("-")[1]) || 0;
      const bNum = parseInt(b.itemId.split("-")[1]) || 0;
      return aNum - bNum;
    });

    // Group units by name to render collapsable rows
    const grouped = items.reduce((acc, item) => {
      if (!acc[item.name]) {
        acc[item.name] = {
          name: item.name,
          category: item.category,
          location: item.location,
          price: item.price,
          status: item.status,
          totalQty: 0,
          borrowed: 0,
          available: 0,
          units: [],
        };
      }
      acc[item.name].units.push(item);
      acc[item.name].totalQty += 1;

      const isAvailable = item.status === "Available";
      if (isAvailable) acc[item.name].available += 1;
      else if (item.status === "In-Use") acc[item.name].borrowed += 1;
      else if (
        ["Maintenance", "Calibration", "Damaged"].includes(item.status)
      ) {
        // Count as neither available nor actively borrowed on dashboard context
      }
      return acc;
    }, {});

    Object.values(grouped).forEach((group, idx) => {
      const tr = document.createElement("tr");
      tr.className = "inventory-group-header";
      tr.style.cursor = "pointer";
      tr.dataset.groupId = `group-${idx}`;

      const priceStr = group.price
        ? `₱${parseFloat(group.price).toFixed(2)}`
        : "N/A";

      // Determine overall status
      let overallStatus = "Available";
      if (group.available === 0) {
        if (group.borrowed > 0) overallStatus = "In-Use";
        else overallStatus = group.units[0].status;
      }
      const statusClass = overallStatus.replace(/[^a-zA-Z0-9]/g, "");

      tr.innerHTML = `
        <td><span class="expand-icon" style="margin-right: 8px; font-weight: bold;">▶</span>${group.units[0].itemId.split("-")[0]} (Batch)</td>
        <td><strong>${group.name}</strong></td>
        <td>${group.category}</td>
        <td>${group.totalQty}</td>
        <td>${group.borrowed}</td>
        <td>${group.available}</td>
        <td>${group.location}</td>
        <td>${priceStr}</td>
        <td><span class="status-badge status-${statusClass}">${overallStatus}</span></td>
        <td>
          <button class="btn" style="background-color: var(--primary-dark); color: white;" onclick="event.stopPropagation(); openBulkEditModal('${group.name}')">Edit All</button>
          <button class="btn" style="background-color: var(--danger); color: white;" onclick="event.stopPropagation(); archiveInventoryModel('${group.units[0].itemId}', '${group.name}', '${ACTIVE_INVENTORY_TYPE}')">Archive All</button>
        </td>
      `;

      tr.addEventListener("click", () => {
        const isCollapsed =
          tr.querySelector(".expand-icon").textContent === "▶";
        tr.querySelector(".expand-icon").textContent = isCollapsed ? "▼" : "▶";
        document
          .querySelectorAll(`tr[data-parent-group="group-${idx}"]`)
          .forEach((child) => {
            child.style.display = isCollapsed ? "table-row" : "none";
          });
      });

      tbody.appendChild(tr);

      // Render individual items
      group.units.forEach((item) => {
        const itemTr = document.createElement("tr");
        itemTr.className = "inventory-item-detail";
        itemTr.dataset.parentGroup = `group-${idx}`;
        itemTr.style.display = "none";
        itemTr.style.backgroundColor = "var(--bg-light)";

        const itemStatusClass = item.status.replace(/[^a-zA-Z0-9]/g, "");
        const itemPrice = item.price
          ? `₱${parseFloat(item.price).toFixed(2)}`
          : "N/A";

        itemTr.innerHTML = `
          <td style="padding-left: 25px;">${item.itemId}</td>
          <td>${item.name}</td>
          <td>${item.category}</td>
          <td>1</td>
          <td>${item.status === "In-Use" ? 1 : 0}</td>
          <td>${item.status === "Available" ? 1 : 0}</td>
          <td>${item.location}</td>
          <td>${itemPrice}</td>
          <td><span class="status-badge status-${itemStatusClass}">${item.status}</span></td>
          <td>
            <button class="btn" style="background-color: var(--primary-dark); color: white;" onclick="openEditModal('${item.itemId}')">Edit</button>
            <button class="btn" style="background-color: var(--danger); color: white;" onclick="archiveInventoryItem('${ACTIVE_INVENTORY_TYPE}', '${item.itemId}')">Archive</button>
          </td>
        `;
        tbody.appendChild(itemTr);
      });
    });
  };

  const findNextSequenceId = (prefix, items) => {
    let maxNum = 0;
    const normalizedPrefix = String(prefix).toUpperCase().trim();
    const escapedPrefix = normalizedPrefix.replace(
      /[.*+?^{\}()|[\]\\/]/g,
      "\\$&",
    );
    const prefixPattern = new RegExp(`^${escapedPrefix}-(\\d+)$`, "i");

    items.forEach((item) => {
      const match = item.itemId.match(prefixPattern);
      if (match) {
        const num = parseInt(match[1]);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    return maxNum + 1;
  };

  async function handleAddItem(e) {
    e.preventDefault();
    const form = e.target;

    const prefix = form
      .querySelector('[name="itemIdPrefix"]')
      .value.toUpperCase()
      .trim();
    const name = form.querySelector('[name="name"]').value.trim();
    const category = form.querySelector('[name="category"]').value;
    const quantity = parseInt(form.querySelector('[name="quantity"]').value);
    const location = form.querySelector('[name="location"]').value;
    const price =
      parseFloat(form.querySelector('[name="price"]')?.value || 0) || 0;

    if (quantity <= 0) {
      showToast("Quantity must be 1 or more.", "error");
      return;
    }
    if (!prefix) {
      showToast("Item ID Prefix cannot be empty.", "error");
      return;
    }

    const config = categoryEndpointMapping[category];

    // Refresh store before sequence calculation
    try {
      const refreshResponse = await fetch(config);
      if (refreshResponse.ok) {
        currentStore = await refreshResponse.json();
      }
    } catch (refreshError) {
      console.warn("Failed to refresh inventory before add:", refreshError);
    }

    const nextSequenceNumber = findNextSequenceId(prefix, currentStore);
    const itemsToCreate = [];
    const maxDigits = Math.max(
      2,
      String(nextSequenceNumber + quantity - 1).length,
    );

    for (let i = 0; i < quantity; i++) {
      const currentNumber = nextSequenceNumber + i;
      let sequence = String(currentNumber).padStart(maxDigits, "0");
      const uniqueItemId = `${prefix}-${sequence}`.toUpperCase().trim();

      itemsToCreate.push({
        itemId: uniqueItemId,
        name: name,
        category: category,
        quantity: 1,
        originalQuantity: 1,
        location: location,
        price: price,
        status: "Available",
      });
    }

    try {
      const response = await fetch(config, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemsToCreate),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage =
          errorBody.message || `Failed to add ${quantity} items.`;
        if (response.status === 409) {
          showToast(`${errorMessage} Duplicate Item ID detected.`, "error");
          fetchInventory();
          return;
        }
        throw new Error(errorMessage);
      }

      showToast(
        `Successfully added ${quantity} items (IDs: ${itemsToCreate[0].itemId} to 	extsf{${itemsToCreate[itemsToCreate.length - 1].itemId}})!`,
        "success",
      );
      form.reset();
      populateCategorySelect(); // Restore selector
      fetchInventory();
    } catch (error) {
      showToast(`Error: ${error.message}`, "error");
    }
  }

  window.openEditModal = async (itemId) => {
    editForm.dataset.type = "inventory";
    editForm.dataset.itemIds = itemId;
    document.getElementById("editItemType").value = ACTIVE_INVENTORY_TYPE;

    try {
      const response = await fetch(`/api/item-details/${itemId}`);
      if (!response.ok) throw new Error();
      const item = await response.json();

      document.getElementById("editItemId").value = item.itemId;
      document.getElementById("editItemIdDisplay").style.display = "block";
      document.getElementById("editItemName").value = item.name;
      document.getElementById("editCategory").value = item.category;
      document.getElementById("editLocation").value = item.location;
      document.getElementById("editPrice").value = item.price || 0;

      editModal.style.display = "flex";
    } catch (e) {
      showToast("Error loading item details.", "error");
    }
  };

  window.openBulkEditModal = (groupName) => {
    const units = currentStore.filter((i) => i.name === groupName);
    if (units.length === 0) return;

    editForm.dataset.type = "inventory";
    editForm.dataset.itemIds = units.map((i) => i.itemId).join(",");
    document.getElementById("editItemType").value = ACTIVE_INVENTORY_TYPE;

    document.getElementById("editItemIdDisplay").style.display = "none";
    document.getElementById("editItemName").value = units[0].name;
    document.getElementById("editCategory").value = units[0].category;
    document.getElementById("editLocation").value = units[0].location;
    document.getElementById("editPrice").value = units[0].price || 0;

    editModal.style.display = "flex";
  };

  async function handleUpdateItem(e) {
    e.preventDefault();
    const itemIdsAttr = editForm.dataset.itemIds;
    const itemIds = itemIdsAttr.split(",").filter(Boolean);
    const api = categoryEndpointMapping[ACTIVE_INVENTORY_TYPE];

    const updatedData = {
      name: document.getElementById("editItemName").value,
      category: document.getElementById("editCategory").value,
      location: document.getElementById("editLocation").value,
      price: parseFloat(document.getElementById("editPrice").value) || 0,
    };

    try {
      const updateRequests = itemIds.map(async (id) => {
        const response = await fetch(`${api}/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedData),
        });
        if (!response.ok) throw new Error();
      });

      await Promise.all(updateRequests);
      showToast("Equipment details updated successfully!", "success");
      editModal.style.display = "none";
      fetchInventory();
    } catch (error) {
      showToast("Error updating equipment.", "error");
    }
  }

  window.archiveInventoryItem = async (type, itemId) => {
    if (!confirm(`Are you sure you want to archive item ${itemId}?`)) return;
    const api = categoryEndpointMapping[type];
    try {
      const response = await fetch(`${api}/${itemId}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      showToast("Item archived successfully.", "success");
      fetchInventory();
    } catch (e) {
      showToast("Error archiving item.", "error");
    }
  };

  window.archiveInventoryModel = (itemId, groupName, type) => {
    if (!confirm(`Are you sure you want to archive ALL units of ${groupName}?`))
      return;
    const itemsToArchive = currentStore
      .filter((i) => i.name === groupName)
      .map((i) => i.itemId);

    if (itemsToArchive.length > 0) {
      let count = 0;
      const api = categoryEndpointMapping[type];
      itemsToArchive.forEach(async (unitId) => {
        await fetch(`${api}/${unitId}`, { method: "DELETE" });
      });
      showToast(
        `Archiving ${itemsToArchive.length} units... Please wait.`,
        "warning",
      );
      setTimeout(fetchInventory, 1000);
    }
  };

  // --- 9. INVENTORY ARCHIVE (DECOMMISSIONED) ---
  const toggleInventoryArchiveView = () => {
    isViewingInventoryArchive = !isViewingInventoryArchive;
    const btn = document.getElementById("toggleInventoryArchiveBtn");
    const title = document.getElementById("inventoryTableTitle");

    if (isViewingInventoryArchive) {
      btn.textContent = "View Active Inventory";
      title.textContent = `Archived ${ACTIVE_INVENTORY_TYPE} Equipment`;
      document.getElementById("inventoryStatusFilter").style.display = "none";
      fetchArchivedInventory();
    } else {
      btn.textContent = "View Archives";
      title.textContent = `${ACTIVE_INVENTORY_TYPE} Equipment`;
      document.getElementById("inventoryStatusFilter").style.display = "block";
      fetchInventory();
    }
  };

  const fetchArchivedInventory = async () => {
    try {
      const response = await fetch("/api/archived-inventory");
      if (!response.ok) throw new Error();
      const allArchived = await response.json();

      // Filter only for the active category archive
      const filtered = allArchived.filter(
        (i) => i.category === ACTIVE_INVENTORY_TYPE,
      );
      renderArchivedInventoryTable(filtered);
    } catch (e) {
      showToast("Error loading archive.", "error");
    }
  };

  const renderArchivedInventoryTable = (items) => {
    const tbody = document.getElementById("inventoryTableBody");
    tbody.innerHTML = "";

    if (items.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="10" style="text-align: center;">No archived equipment.</td></tr>';
      return;
    }

    // Group items by name to support collective bulk actions
    const grouped = items.reduce((acc, item) => {
      if (!acc[item.name]) {
        acc[item.name] = {
          name: item.name,
          category: item.category,
          location: item.location,
          price: item.price,
          units: [],
        };
      }
      acc[item.name].units.push(item);
      return acc;
    }, {});

    Object.values(grouped).forEach((group, idx) => {
      const tr = document.createElement("tr");
      tr.className = "inventory-group-header";
      tr.style.cursor = "pointer";
      tr.dataset.groupId = `archive-group-${idx}`;

      const priceStr = group.price
        ? `₱${parseFloat(group.price).toFixed(2)}`
        : "N/A";

      tr.innerHTML = `
        <td><span class="expand-icon" style="margin-right:8px; font-weight:bold;">▶</span>${group.units[0].itemId.split("-")[0]} (Batch)</td>
        <td><strong>${group.name}</strong></td>
        <td>${group.category}</td>
        <td>${group.units.length}</td>
        <td>0</td>
        <td>0</td>
        <td>${group.location}</td>
        <td>${priceStr}</td>
        <td><span class="status-badge status-Decommissioned">Archived</span></td>
        <td>
          <button class="btn" style="background-color: var(--success); color: white;" onclick="event.stopPropagation(); bulkRestoreModel('${group.name}')">Restore All</button>
          <button class="btn" style="background-color: var(--danger); color: white;" onclick="event.stopPropagation(); deleteInventoryModelPermanently('${group.units[0].itemId}', '${group.name}', '	extsf{${ACTIVE_INVENTORY_TYPE}}')">Delete All</button>
        </td>
      `;

      tr.addEventListener("click", () => {
        const isCollapsed =
          tr.querySelector(".expand-icon").textContent === "▶";
        tr.querySelector(".expand-icon").textContent = isCollapsed ? "▼" : "▶";
        document
          .querySelectorAll(
            `tr[data-parent-group="archive-parent-	extsf{${idx}}"]`,
          )
          .forEach((child) => {
            child.style.display = isCollapsed ? "table-row" : "none";
          });
      });

      tbody.appendChild(tr);

      // Render individual sub units containing selection checkbox for bulk ops
      group.units.forEach((item) => {
        const itemTr = document.createElement("tr");
        itemTr.className = "inventory-item-detail";
        itemTr.dataset.parentGroup = `archive-parent-${idx}`;
        itemTr.style.display = "none";
        itemTr.style.backgroundColor = "var(--bg-light)";

        const itemPrice = item.price
          ? `₱${parseFloat(item.price).toFixed(2)}`
          : "N/A";
        const isChecked = selectedArchivedItems.includes(item.itemId);

        itemTr.innerHTML = `
          <td style="padding-left: 25px;">
            <input type="checkbox" ${isChecked ? "checked" : ""} onchange="toggleSelectArchivedItem('${item.itemId}')" onclick="event.stopPropagation()"/>
            ${item.itemId}
          </td>
          <td>${item.name}</td>
          <td>${item.category}</td>
          <td>1</td>
          <td>0</td>
          <td>0</td>
          <td>${item.location}</td>
          <td>	extsf{${itemPrice}}</td>
          <td><span class="status-badge status-Decommissioned">Archived</span></td>
          <td>
            <button class="btn" style="background-color: var(--success); color: white;" onclick="restoreItem('${item.itemId}')">Restore</button>
            <button class="btn" style="background-color: var(--danger); color: white;" onclick="deleteItemPermanently('${item.itemId}')">Delete</button>
          </td>
        `;
        tbody.appendChild(itemTr);
      });
    });

    renderBulkActionBar();
  };

  window.toggleSelectArchivedItem = (itemId) => {
    const idx = selectedArchivedItems.indexOf(itemId);
    if (idx === -1) selectedArchivedItems.push(itemId);
    else selectedArchivedItems.splice(idx, 1);
    renderBulkActionBar();
  };

  const renderBulkActionBar = () => {
    let bar = document.getElementById("bulkActionBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "bulkActionBar";
      bar.className = "bulk-action-bar";
      bar.style.cssText =
        "position:fixed; bottom:20px; right:20px; background:var(--primary-dark); color:white; padding:15px 25px; border-radius:10px; display:none; align-items:center; gap:15px; box-shadow:0 8px 30px rgba(0,0,0,0.15); z-index:1000;";
      document.body.appendChild(bar);
    }

    if (selectedArchivedItems.length > 0 && isViewingInventoryArchive) {
      bar.style.display = "flex";
      bar.innerHTML = `
        <span><strong>${selectedArchivedItems.length}</strong> item(s) selected</span>
        <button class="btn" style="background-color: var(--success); color:white;" onclick="bulkRestoreSelected()">Restore Selected</button>
        <button class="btn" style="background-color: var(--danger); color:white;" onclick="bulkDeleteSelected()">Delete Selected</button>
        <button class="btn" style="background-color: #7f8c8d; color:white;" onclick="clearBulkSelection()">Cancel</button>
      `;
    } else {
      bar.style.display = "none";
    }
  };

  window.clearBulkSelection = () => {
    selectedArchivedItems = [];
    document
      .querySelectorAll('.inventory-item-detail input[type="checkbox"]')
      .forEach((c) => (c.checked = false));
    renderBulkActionBar();
  };

  window.restoreItem = async (itemId) => {
    try {
      const res = await fetch(`/api/inventory/restore/${itemId}`, {
        method: "PUT",
      });
      if (!res.ok) throw new Error();
      showToast(`Item ${itemId} restored successfully.`, "success");
      fetchArchivedInventory();
    } catch (e) {
      showToast("Error restoring item.", "error");
    }
  };

  window.bulkRestoreModel = async (groupName) => {
    const itemsToRestore = currentStore
      .filter((i) => i.name === groupName && i.status === "Decommissioned")
      .map((i) => i.itemId);
    if (itemsToRestore.length === 0) {
      // If we don't have decommissioned items in the currentStore, we must fetch from archive
      try {
        const response = await fetch("/api/archived-inventory");
        if (response.ok) {
          const allArchived = await response.json();
          const matches = allArchived.filter(
            (i) => i.name === groupName && i.category === ACTIVE_INVENTORY_TYPE,
          );
          matches.forEach(async (item) => {
            await fetch(`/api/inventory/restore/${item.itemId}`, {
              method: "PUT",
            });
          });
          showToast(
            `Restoring ${matches.length} items... Please wait.`,
            "success",
          );
          setTimeout(fetchArchivedInventory, 1000);
          return;
        }
      } catch (err) {}
    }

    if (itemsToRestore.length > 0) {
      itemsToRestore.forEach(async (id) => {
        await fetch(`/api/inventory/restore/	extsf{${id}}`, { method: "PUT" });
      });
      showToast(
        `Restoring ${itemsToRestore.length} units... Please wait.`,
        "success",
      );
      setTimeout(fetchArchivedInventory, 1000);
    }
  };

  window.bulkRestoreSelected = async () => {
    if (selectedArchivedItems.length === 0) return;
    if (!confirm(`Restore ${selectedArchivedItems.length} item(s)?`)) return;

    try {
      let count = 0;
      for (const id of selectedArchivedItems) {
        const res = await fetch(`/api/inventory/restore/${id}`, {
          method: "PUT",
        });
        if (res.ok) count++;
      }
      showToast(`Successfully restored ${count} item(s).`, "success");
      selectedArchivedItems = [];
      fetchArchivedInventory();
    } catch (e) {
      showToast("Error in bulk restore.", "error");
    }
  };

  window.deleteItemPermanently = async (itemId) => {
    if (
      !confirm(
        `WARNING: Permanently delete item ${itemId}? This action CANNOT be undone.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/inventory/permanent/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      showToast("Item permanently deleted.", "success");
      fetchArchivedInventory();
    } catch (e) {
      showToast("Error permanently deleting item.", "error");
    }
  };

  window.deleteInventoryModelPermanently = async (itemId, groupName, type) => {
    if (
      !confirm(
        `WARNING: Permanently delete ALL units of ${groupName}? This CANNOT be undone!`,
      )
    )
      return;
    try {
      const response = await fetch("/api/archived-inventory");
      if (response.ok) {
        const allArchived = await response.json();
        const matches = allArchived.filter(
          (i) => i.name === groupName && i.category === type,
        );

        let count = 0;
        for (const item of matches) {
          const res = await fetch(`/api/inventory/permanent/${item.itemId}`, {
            method: "DELETE",
          });
          if (res.ok) count++;
        }
        showToast(`Permanently deleted ${count} units.`, "success");
        fetchArchivedInventory();
      }
    } catch (err) {
      showToast("Error permanently deleting models.", "error");
    }
  };

  window.bulkDeleteSelected = async () => {
    if (selectedArchivedItems.length === 0) return;
    if (
      !confirm(
        `WARNING: Permanently delete ${selectedArchivedItems.length} item(s)? This CANNOT be undone!`,
      )
    )
      return;

    try {
      let count = 0;
      for (const id of selectedArchivedItems) {
        const res = await fetch(`/api/inventory/permanent/${id}`, {
          method: "DELETE",
        });
        if (res.ok) count++;
      }
      showToast(
        `Successfully permanently deleted 	extsf{${count}} item(s).`,
        "success",
      );
      selectedArchivedItems = [];
      fetchArchivedInventory();
    } catch (e) {
      showToast("Error in bulk delete.", "error");
    }
  };

  // --- 10. BORROW REQUESTS HANDLING ---
  const fetchAllRequests = async () => {
    const api = getRequestsEndpoint();
    try {
      const res = await fetch(api);
      if (!res.ok) throw new Error();
      allRequestsData = await res.json();
      renderRequestsTable();
    } catch (e) {
      showToast("Error loading requests.", "error");
    }
  };

  const fetchDeletedRequests = async () => {
    try {
      const res = await fetch("/api/deleted-requests");
      if (!res.ok) throw new Error();
      allRequestsData = await res.json();
      renderRequestsTable();
    } catch (e) {
      showToast("Error loading deleted requests.", "error");
    }
  };

  const renderRequestsTable = () => {
    const query = requestSearch.value.trim().toLowerCase();
    const status = requestStatusFilter.value;
    requestsTableBody.innerHTML = "";

    let items = allRequestsData;
    if (status !== "All") {
      items = items.filter((r) => r.status === status);
    }
    if (query !== "") {
      items = items.filter(
        (r) =>
          String(r.studentName).toLowerCase().includes(query) ||
          String(r.studentID).toLowerCase().includes(query) ||
          String(r.itemName).toLowerCase().includes(query) ||
          String(r.itemId).toLowerCase().includes(query),
      );
    }

    if (items.length === 0) {
      requestsTableBody.innerHTML =
        '<tr><td colspan="9" style="text-align: center;">No requests found.</td></tr>';
      return;
    }

    items.forEach((req) => {
      const tr = document.createElement("tr");
      const statusClass = req.status;
      const reqDate = new Date(req.requestDate).toLocaleDateString();
      const dueDate = req.dueDate
        ? new Date(req.dueDate).toLocaleDateString()
        : "N/A";

      let actionButtons = "";
      if (isViewingTrash) {
        actionButtons = `
          <button class="btn" style="background-color: var(--success); color: white;" onclick="restoreRequest('${req._id}')">Restore</button>
          <button class="btn" style="background-color: var(--danger); color: white;" onclick="permanentDeleteRequest('${req._id}')">Delete</button>
        `;
      } else {
        if (req.status === "Pending") {
          actionButtons = `
            <button class="btn" style="background-color: var(--success); color: white;" onclick="handleRequest('${req._id}', 'Approved')">Approve</button>
            <button class="btn" style="background-color: var(--danger); color: white;" onclick="handleRequest('${req._id}', 'Rejected')">Reject</button>
          `;
        } else if (req.status === "Approved") {
          actionButtons = `
            <button class="btn" style="background-color: var(--primary-dark); color: white;" onclick="handleRequest('${req._id}', 'Returned')">Mark Returned</button>
          `;
        }
        actionButtons += `
          <button class="btn" style="background-color: #e0e0e0; color: #333;" onclick="openViewRequestDetailsModal('	extsf{${req._id}}')">Details</button>
          <button class="btn" style="background-color: var(--danger); color: white; margin-left: 5px;" onclick="deleteRequest('${req._id}')">🗑️</button>
        `;
      }

      tr.innerHTML = `
        <td>${req.studentName}</td>
        <td>${req.studentID}</td>
        <td>${req.itemName}</td>
        <td>${req.itemId}</td>
        <td>${req.quantity}</td>
        <td>${reqDate}</td>
        <td>${dueDate}</td>
        <td><span class="status-badge status-${statusClass}">${req.status}</span></td>
        <td>${actionButtons}</td>
      `;
      requestsTableBody.appendChild(tr);
    });
  };

  window.handleRequest = async (requestId, status) => {
    try {
      const res = await fetch(`/api/update-request/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "Status update failed.");

      showToast(`Request ${status.toLowerCase()} successfully!`, "success");
      fetchAllRequests();
    } catch (e) {
      showToast(`Error: ${e.message}`, "error");
    }
  };

  window.deleteRequest = async (id) => {
    if (!confirm("Move request to trash?")) return;
    try {
      const res = await fetch(`/api/requests/${id}/delete`, { method: "PUT" });
      if (!res.ok) throw new Error();
      showToast("Moved request to trash.", "success");
      fetchAllRequests();
    } catch (e) {
      showToast("Error deleting request.", "error");
    }
  };

  window.restoreRequest = async (id) => {
    try {
      const res = await fetch(`/api/requests/${id}/restore`, { method: "PUT" });
      if (!res.ok) throw new Error();
      showToast("Request restored.", "success");
      fetchDeletedRequests();
    } catch (e) {
      showToast("Error restoring request.", "error");
    }
  };

  window.permanentDeleteRequest = async (id) => {
    if (!confirm("WARNING: Permanently delete request? This cannot be undone."))
      return;
    try {
      const res = await fetch(`/api/requests/	extsf{${id}}/permanent`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      showToast("Request permanently deleted.", "success");
      fetchDeletedRequests();
    } catch (e) {
      showToast("Error permanently deleting request.", "error");
    }
  };

  const toggleRequestView = () => {
    isViewingTrash = !isViewingTrash;
    if (isViewingTrash) {
      toggleTrashViewBtn.textContent = "View Active Requests";
      requestsTitle.textContent = "Trash / Deleted Requests";
      fetchDeletedRequests();
    } else {
      toggleTrashViewBtn.textContent = "View Trash";
      requestsTitle.textContent = "Borrowing Requests";
      fetchAllRequests();
    }
  };

  window.openViewRequestDetailsModal = async (requestId) => {
    const modal = document.getElementById("viewRequestDetailsModal");
    const container = document.getElementById("viewRequestDetailsContent");
    container.innerHTML = "<p>Loading request details...</p>";
    modal.style.display = "flex";

    try {
      const request = allRequestsData.find((r) => r._id === requestId);
      if (!request) throw new Error();

      let detailsHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
          <div><strong>Student Name:</strong> ${request.studentName}</div>
          <div><strong>Student ID:</strong> ${request.studentID}</div>
          <div><strong>Item Name:</strong> ${request.itemName}</div>
          <div><strong>Item ID:</strong> ${request.itemId}</div>
          <div><strong>Quantity:</strong> ${request.quantity}</div>
          <div><strong>Category:</strong> ${request.category}</div>
          <div><strong>Request Date:</strong> ${new Date(request.requestDate).toLocaleString()}</div>
          <div><strong>Status:</strong> <span class="status-badge status-${request.status}">${request.status}</span></div>
        </div>
        <div style="margin-top:1rem;">
          <strong>Reason for Borrowing:</strong>
          <div style="background:var(--bg-light); padding:10px; border-radius:5px; margin-top:5px;">${request.reason || "No reason provided."}</div>
        </div>
      `;
      container.innerHTML = detailsHTML;
    } catch (e) {
      container.innerHTML =
        '<p style="color:var(--danger)">Error loading request details.</p>';
    }
  };

  window.closeViewRequestDetailsModal = () => {
    document.getElementById("viewRequestDetailsModal").style.display = "none";
  };

  // --- 11. LIVE BARCODE SCANNING SYSTEM ---
  function resetScannerUI() {
    currentBorrowingStudentId = null;
    scannedEquipmentId = null;
    studentIdInput.value = "";
    itemIdInput.value = "";
    studentIdInput.readOnly = false;

    scanStatus.textContent = "Awaiting scan...";
    scanStatus.className = "status-box";

    scanAnotherItemBtn.style.display = "none";
    cancelScanBtn.style.display = "none";
    updateStatusBtn.style.display = "none";

    const mode = scanMode.value;
    studentIdGroup.style.display = "none";
    itemIdGroup.style.display = "none";

    if (mode === "Borrowing") {
      studentIdGroup.style.display = "block";
      studentIdInput.placeholder = "Scan student ID to BORROW...";
      studentIdInput.focus();
    } else {
      itemIdGroup.style.display = "block";
      if (mode === "Returning")
        itemIdInput.placeholder = "Scan item to RETURN...";
      else if (mode === "Status Check")
        itemIdInput.placeholder = "Scan item for STATUS CHECK...";
      else if (mode === "Equipment")
        itemIdInput.placeholder = "Scan item to change status...";
      itemIdInput.focus();
    }
    clearTrackingDetails();
  }

  function clearTrackingDetails() {
    trackingDetailsContainer.innerHTML =
      "<p>Scan an item to see its details here.</p>";
  }

  window.scanAnotherItem = () => {
    const mode = scanMode.value;
    if (mode === "Borrowing" && currentBorrowingStudentId) {
      itemIdInput.value = "";
      scanStatus.textContent = `Student ID ${currentBorrowingStudentId} captured. Scan next item.`;
      scanStatus.className = "status-box info";
      scanAnotherItemBtn.style.display = "none";
      cancelScanBtn.style.display = "inline-block";
      itemIdInput.focus();
    } else {
      scannedEquipmentId = null;
      itemIdInput.value = "";
      scanStatus.textContent = "Awaiting scan for next item...";
      scanStatus.className = "status-box";
      updateStatusBtn.style.display = "none";
      scanAnotherItemBtn.style.display = "none";
      cancelScanBtn.style.display = "none";
      clearTrackingDetails();
      itemIdInput.focus();
    }
  };

  window.cancelTransaction = () => {
    showToast("Transaction cancelled. Scanner reset.");
    resetScannerUI();
  };

  async function fetchAndDisplayItemDetails(itemId) {
    trackingDetailsContainer.innerHTML = "<p>Loading item details...</p>";
    try {
      const response = await fetch(`/api/item-details/${itemId}`);
      if (!response.ok) {
        if (response.status === 404)
          throw new Error(`Item ID ${itemId} not found.`);
        throw new Error();
      }
      const data = await response.json();
      const originalQty = data.originalQuantity || data.quantity || 0;
      const availableQty = data.quantity || 0;
      const borrowedQty = originalQty - availableQty;
      const currentStatus =
        borrowedQty > 0 &&
        !["Maintenance", "Calibration", "Damaged"].includes(data.status)
          ? "In-Use"
          : data.status;
      const statusClass = currentStatus.replace(/[^a-zA-Z0-9]/g, "");

      let trackingHTML = `
        <h3>${data.name}</h3>
        <p>
          <strong>ID:</strong> ${data.itemId} |
          <strong>Category:</strong> ${data.category} |
          <strong>Location:</strong> ${data.location}
        </p>
        <p>
          <strong>Current Status:</strong> <span class="status-badge status-${statusClass}">${currentStatus}</span> |
          <strong>Available Qty:</strong> ${availableQty} / ${originalQty}
        </p>
      `;

      if (borrowedQty > 0 && data.currentLoan) {
        trackingHTML += `
          <div id="trackingBorrowerInfo">
            <p class="detail-item">Currently Borrowed By:</p>
            <span>${data.currentLoan.studentName} (${data.currentLoan.studentID})</span><br>
            <span><strong>Due Date:</strong> ${new Date(data.currentLoan.dueDate).toLocaleDateString()}</span>
          </div>
        `;
      }

      trackingHTML += '<h4>History</h4><div id="trackingHistoryLog">';
      if (data.history && data.history.length > 0) {
        data.history
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .forEach((log) => {
            trackingHTML += `<div><strong>${log.action}</strong> by ${log.studentName || "N/A"} on ${new Date(log.timestamp).toLocaleString()}</div>`;
          });
      } else {
        trackingHTML += "<div>No history records found.</div>";
      }
      trackingHTML += "</div>";

      trackingDetailsContainer.innerHTML = trackingHTML;
      return { success: true, status: currentStatus, itemData: data };
    } catch (error) {
      trackingDetailsContainer.innerHTML = `<p style="color:var(--danger)">${error.message || "Error loading details."}</p>`;
      return { success: false, message: error.message };
    }
  }

  async function processScan(triggeredInput) {
    const mode = scanMode.value;
    const isStudentInput = triggeredInput === studentIdInput;
    const isItemInput = triggeredInput === itemIdInput;

    const finalItemId = itemIdInput.value.trim();
    const finalStudentId = studentIdInput.value.trim();

    if (mode === "Borrowing" && isStudentInput && finalStudentId !== "") {
      currentBorrowingStudentId = finalStudentId;
      studentIdInput.readOnly = true;
      scanStatus.textContent = `Student ID ${currentBorrowingStudentId} captured. Scan equipment barcode.`;
      scanStatus.className = "status-box info";
      itemIdGroup.style.display = "block";
      itemIdInput.focus();
      cancelScanBtn.style.display = "inline-block";
      return;
    }

    if (isItemInput && finalItemId !== "") {
      const itemId = finalItemId;
      disableAutoSubmit();
      itemIdInput.value = "";

      const details = await fetchAndDisplayItemDetails(itemId);
      if (!details.success) {
        scanStatus.textContent = `Error: ${details.message}`;
        scanStatus.className = "status-box error";
        scanAnotherItemBtn.style.display = "inline-block";
        cancelScanBtn.style.display = "inline-block";
        enableAutoSubmit();
        itemIdInput.focus();
        return;
      }

      if (mode === "Borrowing" && currentBorrowingStudentId) {
        if (
          ["Maintenance", "Calibration", "Damaged"].includes(details.status)
        ) {
          scanStatus.textContent = `Error: Item ${itemId} is ${details.status} and cannot be borrowed.`;
          scanStatus.className = "status-box error";
        } else {
          try {
            const res = await fetch("/api/borrow-by-barcode", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                itemId,
                studentID: currentBorrowingStudentId,
              }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.message || "Failed to borrow.");
            scanStatus.textContent = result.message;
            scanStatus.className = "status-box success";
            showToast("Item borrowed successfully!", "success");
            fetchInventory();
          } catch (e) {
            scanStatus.textContent = e.message;
            scanStatus.className = "status-box error";
          }
        }
        scanAnotherItemBtn.style.display = "inline-block";
        cancelScanBtn.style.display = "inline-block";
        enableAutoSubmit();
      } else if (mode === "Returning") {
        if (details.itemData && details.itemData.currentLoan) {
          const modal = document.getElementById("returnConditionModal");
          document.getElementById("returnConditionItemId").value = itemId;
          document.getElementById("modalItemName").textContent =
            details.itemData.name;
          document.getElementById("modalBorrowerName").textContent =
            `${details.itemData.currentLoan.studentName} (${details.itemData.currentLoan.studentID})`;

          document.getElementById("conditionSelect").value = "Good";
          document.getElementById("damageNotes").value = "";
          document.getElementById("damageNotesLabel").style.display = "none";
          document.getElementById("damageNotes").style.display = "none";
          document.getElementById("damageNotes").required = false;

          modal.style.display = "flex";
        } else {
          scanStatus.textContent = `Error: No active loan found for item 	extsf{${itemId}}.`;
          scanStatus.className = "status-box error";
          scanAnotherItemBtn.style.display = "inline-block";
          cancelScanBtn.style.display = "inline-block";
          enableAutoSubmit();
          itemIdInput.focus();
        }
      } else if (mode === "Status Check") {
        scanStatus.textContent = `Item ${itemId} is ${details.status}.`;
        scanStatus.className = "status-box info";
        scanAnotherItemBtn.style.display = "inline-block";
        cancelScanBtn.style.display = "inline-block";
        enableAutoSubmit();
        itemIdInput.focus();
      } else if (mode === "Equipment") {
        renderEquipmentStatusChange(details.itemData);
        enableAutoSubmit();
      }
    }
  }

  function renderEquipmentStatusChange(itemData) {
    scannedEquipmentId = itemData.itemId;
    const statusClass = itemData.status.replace(/[^a-zA-Z0-9]/g, "");
    trackingDetailsContainer.innerHTML = `
      <h3>${itemData.name} (${itemData.itemId})</h3>
      <p>
        <strong>Current Status:</strong> <span class="status-badge status-${statusClass}">${itemData.status}</span><br>
        <strong>Available Qty:</strong> ${itemData.quantity || 0} / ${itemData.originalQuantity || 0}
      </p>
      <div class="form-group" style="margin-top:1.5rem;">
        <label for="newEquipmentStatus">Change Status To:</label>
        <select id="newEquipmentStatus" class="prefix-input">
          <option value="Available" ${itemData.status === "Available" ? "selected" : ""}>Available</option>
          <option value="Maintenance" ${itemData.status === "Maintenance" ? "selected" : ""}>Maintenance</option>
          <option value="Calibration" ${itemData.status === "Calibration" ? "selected" : ""}>Calibration</option>
          <option value="Damaged" ${itemData.status === "Damaged" ? "selected" : ""}>Damaged</option>
        </select>
      </div>
    `;
    scanStatus.textContent = `Item ${itemData.itemId} is ready for status modification.`;
    scanStatus.className = "status-box info";
    updateStatusBtn.style.display = "inline-block";
    cancelScanBtn.style.display = "inline-block";
    scanAnotherItemBtn.style.display = "none";
  }

  window.updateEquipmentStatus = async () => {
    const newStatus = document.getElementById("newEquipmentStatus").value;
    const itemId = scannedEquipmentId;
    if (!itemId) return;

    // Find the item category and api
    const originalItem = currentStore.find((i) => i.itemId === itemId);
    const api = categoryEndpointMapping[ACTIVE_INVENTORY_TYPE];

    if (!originalItem) {
      showToast("Item not found in active category context.", "error");
      return;
    }

    try {
      scanStatus.textContent = "Updating status...";
      const isNowUnavailable = [
        "Maintenance",
        "Calibration",
        "Damaged",
      ].includes(newStatus);
      const updateData = {
        status: newStatus,
        quantity: isNowUnavailable ? 0 : originalItem.originalQuantity,
      };

      const response = await fetch(`${api}/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      if (!response.ok) throw new Error();

      showToast(`Item ${itemId} status updated to ${newStatus}!`, "success");
      scanStatus.textContent = `Success: Item ${itemId} updated to ${newStatus}.`;
      scanStatus.className = "status-box success";

      fetchInventory();
      setTimeout(() => fetchAndDisplayItemDetails(itemId), 500);

      updateStatusBtn.style.display = "none";
      scanAnotherItemBtn.style.display = "inline-block";
      cancelScanBtn.style.display = "inline-block";
    } catch (e) {
      showToast("Error updating status.", "error");
      scanStatus.textContent = "Error updating status.";
      scanStatus.className = "status-box error";
    }
  };

  window.handleReturnConditionSubmission = async (e) => {
    e.preventDefault();
    const modal = document.getElementById("returnConditionModal");
    const finalItemId = document.getElementById("returnConditionItemId").value;
    const returnCondition = document.getElementById("conditionSelect").value;
    const damageNotes = document.getElementById("damageNotes").value.trim();

    if (["Damaged", "Lost"].includes(returnCondition) && damageNotes === "") {
      showToast("Notes on damage/loss are required.", "error");
      return;
    }

    modal.style.display = "none";
    disableAutoSubmit();

    try {
      const response = await fetch("/api/return-by-barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: finalItemId,
          condition: returnCondition,
          damageNotes: damageNotes,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Return failed.");

      scanStatus.textContent = result.message;
      scanStatus.className = "status-box success";
      showToast(result.message, "success");
      fetchAndDisplayItemDetails(finalItemId);
      fetchInventory();
    } catch (error) {
      scanStatus.textContent = error.message;
      scanStatus.className = "status-box error";
    } finally {
      scanAnotherItemBtn.style.display = "inline-block";
      cancelScanBtn.style.display = "inline-block";
      enableAutoSubmit();
      itemIdInput.focus();
    }
  };

  // --- 12. HISTORY LOGS ---
  const fetchHistoryLogs = async () => {
    try {
      const res = await fetch("/api/admin/history");
      if (!res.ok) throw new Error();
      allHistoryLogs = await res.json();
      renderHistoryLogs();
    } catch (e) {
      showToast("Error fetching history logs.", "error");
    }
  };

  const renderHistoryLogs = () => {
    const tbody = document.getElementById("historyTableBody");
    const filter = historyActionFilter.value;
    tbody.innerHTML = "";

    let logs = allHistoryLogs;
    if (filter !== "All") {
      logs = logs.filter((l) => l.action === filter);
    }

    if (logs.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align: center;">No history logs found.</td></tr>';
      return;
    }

    logs.forEach((log) => {
      const tr = document.createElement("tr");
      const time = new Date(log.timestamp).toLocaleString();
      tr.innerHTML = `
        <td>${log.adminUsername}</td>
        <td><strong>${log.action}</strong></td>
        <td>${log.details}</td>
        <td>${time}</td>
      `;
      tbody.appendChild(tr);
    });
  };

  // --- 13. REPORTS GENERATOR ---
  const handleGenerateReport = async () => {
    const reportType = reportTypeSelect.value;
    if (!reportType) return;
    reportResult.innerHTML = "<p>Generating report...</p>";
    reportResult.style.display = "block";

    try {
      const response = await fetch(
        `/api/reports?type=${reportType}&period=${selectedPeriod}`,
      );
      if (!response.ok) throw new Error();
      const reportText = await response.text();
      reportResult.innerHTML = reportText;
      printReportBtn.style.display = "inline-block";
      showToast("Report generated successfully!", "success");
    } catch (e) {
      showToast("Error generating report.", "error");
      reportResult.innerHTML =
        '<p style="color:var(--danger)">Failed to generate report.</p>';
    }
  };

  const handlePrintReport = () => {
    const printWindow = window.open("", "", "width=800,height=600");
    printWindow.document.write(`<html><head><title>LabLinX Report</title><style>
      body { font-family: 'Times New Roman', serif; padding: 20px; font-size: 11pt; color: #111; }
      table { border-collapse: collapse; width: 100%; margin-top: 10px; font-size: 10pt; }
      th, td { border: 1px solid #000; padding: 6px; text-align: left; }
      th { background-color: #f0f0f0; color: #000; font-weight: bold; text-transform: uppercase; }
      .report-header { text-align: center; margin-bottom: 20px; }
      .report-header img { width: 80px; height: 80px; margin-bottom: 10px; }
      .report-header h2 { margin: 0; font-size: 18pt; color: #00503B; font-weight: bold; }
      .report-header h3 { margin: 5px 0 0 0; font-size: 14pt; color: #007A5A; }
    </style></head><body>
      <div class="report-header">
        <img src="logo.png" alt="University Logo">
        <h2>De La Salle University - Dasmariñas</h2>
        <h3>LabLinX Inventory Management System</h3>
      </div>
      <div class="report-content">${reportResult.innerHTML}</div>
    </body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 300);
  };

  // --- 14. ADMIN NOTIFICATIONS ---
  const fetchAdminNotifications = async () => {
    try {
      const res = await fetch("/api/admin/notifications");
      if (!res.ok) throw new Error();
      notifications = await res.json();

      const unread = notifications.filter((n) => !n.isRead).length;
      if (notificationBadge) {
        notificationBadge.textContent = unread;
        notificationBadge.style.display = unread > 0 ? "inline-block" : "none";
      }
    } catch (e) {
      console.warn("Failed to load notifications.");
    }
  };

  const renderNotifications = () => {
    const list = document.getElementById("notification-list");
    list.innerHTML = "";

    if (notifications.length === 0) {
      list.innerHTML = "<li>No notifications yet.</li>";
      return;
    }

    notifications.forEach((notif) => {
      const li = document.createElement("li");
      li.className = notif.isRead ? "read" : "unread";
      li.innerHTML = `
        <div class="notif-header">
          <strong>${notif.title}</strong>
          <span class="time">${new Date(notif.createdAt).toLocaleDateString()}</span>
        </div>
        <p>${notif.message}</p>
      `;
      list.appendChild(li);
    });

    markNotificationsRead();
  };

  const markNotificationsRead = async () => {
    try {
      await fetch("/api/notifications/mark-read", { method: "POST" });
      setTimeout(fetchAdminNotifications, 1000);
    } catch (err) {}
  };

  // --- 15. SYSTEM SETTINGS ---
  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/system-settings");
      if (!res.ok) throw new Error();
      const settings = await res.json();

      document.getElementById("settingBorrowLimit").value =
        settings.borrowing_limit || 5;
      document.getElementById("settingMaxDays").value =
        settings.max_borrow_days || 14;
      document.getElementById("settingReservationDays").value =
        settings.reservation_max_days || 7;
      document.getElementById("settingReplacementDays").value =
        settings.replacement_return_days || 7;
    } catch (error) {
      console.error(error);
    }
  };

  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", async () => {
      try {
        const updates = [
          {
            key: "borrowing_limit",
            value: parseInt(
              document.getElementById("settingBorrowLimit").value,
            ),
          },
          {
            key: "max_borrow_days",
            value: parseInt(document.getElementById("settingMaxDays").value),
          },
          {
            key: "reservation_max_days",
            value: parseInt(
              document.getElementById("settingReservationDays").value,
            ),
          },
          {
            key: "replacement_return_days",
            value: parseInt(
              document.getElementById("settingReplacementDays").value,
            ),
          },
        ];
        for (const update of updates) {
          await fetch(`/api/system-settings/${update.key}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: update.value }),
          });
        }
        showToast("System settings saved successfully!", "success");
      } catch (err) {
        showToast("Error saving settings.", "error");
      }
    });
  }

  // --- 16. SUPER ADMIN OVERSIGHT DATA LOADING ---
  const loadSuperAdminData = async () => {
    try {
      const [inv2, inv3, inv4, inv5, inv6, inv7, inv8] = await Promise.all([
        fetch("/api/inventory2").then((res) => res.json()),
        fetch("/api/inventory3").then((res) => res.json()),
        fetch("/api/inventory4").then((res) => res.json()),
        fetch("/api/inventory5").then((res) => res.json()),
        fetch("/api/inventory6").then((res) => res.json()),
        fetch("/api/inventory7").then((res) => res.json()),
        fetch("/api/inventory8").then((res) => res.json()),
      ]);

      superAdmin2ScienceData = inv2;
      superAdmin2SportsData = inv3;
      superAdmin3InventoryData = [...inv4, ...inv5, ...inv6, ...inv8];
      superAdmin4InventoryData = inv7;

      renderSuperAdminInventoryTable(
        superAdmin2ScienceData,
        document
          .getElementById("tableAdmin2ScienceInventory")
          .querySelector("tbody"),
      );
      renderSuperAdminInventoryTable(
        superAdmin2SportsData,
        document
          .getElementById("tableAdmin2SportsInventory")
          .querySelector("tbody"),
      );
      renderSuperAdminInventoryTable(
        superAdmin3InventoryData,
        document.getElementById("tableAdmin3Inventory").querySelector("tbody"),
      );
      renderSuperAdminInventoryTable(
        superAdmin4InventoryData,
        superAdmin4InventoryData,
        document.getElementById("tableAdmin4Inventory").querySelector("tbody"),
      );
    } catch (error) {
      showToast("Error loading monitored oversight tables.", "error");
    }
  };

  const renderSuperAdminInventoryTable = (items, tbody, filter = "All") => {
    if (!tbody) return;
    tbody.innerHTML = "";

    let filtered = items;
    if (filter !== "All") {
      filtered = filtered.filter((i) => i.status === filter);
    }

    if (filtered.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align: center;">No monitored equipment.</td></tr>';
      return;
    }

    filtered.forEach((item) => {
      const tr = document.createElement("tr");
      const statusClass = item.status.replace(/[^a-zA-Z0-9]/g, "");
      tr.innerHTML = `
        <td>${item.itemId}</td>
        <td><strong>${item.name}</strong></td>
        <td>${item.category}</td>
        <td>${item.quantity}</td>
        <td>	extsf{${item.location}}</td>
        <td><span class="status-badge status-${statusClass}">${item.status}</span></td>
      `;
      tbody.appendChild(tr);
    });
  };

  // --- 17. SUPER ADMIN USER MANAGEMENT ---
  const fetchAllUsers = async () => {
    try {
      const res = await fetch("/api/all-users");
      if (!res.ok) throw new Error();
      allUsersData = await res.json();
      renderUsersTable();
    } catch (e) {
      showToast("Error loading user accounts.", "error");
    }
  };

  const renderUsersTable = () => {
    const query = document
      .getElementById("searchUsers")
      .value.trim()
      .toLowerCase();
    usersTableBody.innerHTML = "";

    let users = allUsersData;
    if (query !== "") {
      users = users.filter(
        (u) =>
          String(u.username).toLowerCase().includes(query) ||
          String(u.email).toLowerCase().includes(query) ||
          String(u.studentID).toLowerCase().includes(query),
      );
    }

    if (users.length === 0) {
      usersTableBody.innerHTML =
        '<tr><td colspan="8" style="text-align: center;">No users found.</td></tr>';
      return;
    }

    users.forEach((user) => {
      const tr = document.createElement("tr");
      const isPending = user.status === "Pending";
      const isSuper = user.username.toLowerCase() === "admin2";

      let actions = "";
      if (!isSuper) {
        actions = `
          <button class="btn" style="background-color: var(--primary-dark); color:white;" onclick="changeUserRole('${user._id}', '${user.role === "admin" ? "student" : "admin"}')">Toggle Admin</button>
          <button class="btn" style="background-color: var(--warning); color:white;" onclick="resetUserPassword('${user._id}')">Reset Pass</button>
          <button class="btn" style="background-color: var(--danger); color:white;" onclick="deleteUser('	extsf{${user._id}}')">Delete</button>
        `;
      }

      tr.innerHTML = `
        <td>${user.studentID}</td>
        <td>${user.lastName}, ${user.firstName}</td>
        <td>${user.username}</td>
        <td>${user.email}</td>
        <td>${user.gradeLevel}</td>
        <td><span class="status-badge status-${user.role}">${user.role}</span></td>
        <td><span class="status-badge status-${user.status}">${user.status}</span></td>
        <td>${actions}</td>
      `;
      usersTableBody.appendChild(tr);
    });
  };

  window.changeUserRole = async (userId, role) => {
    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error();
      showToast("User role updated successfully!", "success");
      fetchAllUsers();
    } catch (e) {
      showToast("Error changing user role.", "error");
    }
  };

  window.resetUserPassword = async (userId) => {
    const newPassword = prompt("Enter new password for this user:");
    if (!newPassword) return;

    try {
      const res = await fetch(`/api/users/${userId}/reset-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      if (!res.ok) throw new Error();
      showToast("Password reset successful!", "success");
    } catch (e) {
      showToast("Error resetting password.", "error");
    }
  };

  window.deleteUser = async (userId) => {
    if (!confirm("Are you sure you want to permanently delete this user?"))
      return;
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      showToast("User deleted successfully.", "success");
      fetchAllUsers();
    } catch (e) {
      showToast("Error deleting user.", "error");
    }
  };

  const toggleUserArchiveView = () => {
    showToast("User archiving not supported in this server build.", "warning");
  };

  // --- 18. SUPER ADMIN PROFILE APPROVALS ---
  const fetchProfileUpdateRequests = async () => {
    try {
      const res = await fetch("/api/profile-update-requests");
      if (!res.ok) throw new Error();
      const requests = await res.json();
      renderProfileRequestsTable(requests);
    } catch (e) {
      showToast("Error fetching profile updates.", "error");
    }
  };

  const renderProfileRequestsTable = (requests) => {
    const tbody = document.getElementById("profileRequestsTableBody");
    tbody.innerHTML = "";

    if (requests.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align: center;">No pending profile update requests.</td></tr>';
      return;
    }

    requests.forEach((req) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${req.username}</td>
        <td>${req.currentFullName}</td>
        <td>${req.newFirstName} ${req.newLastName}</td>
        <td>${req.newEmail}</td>
        <td>
          <button class="btn" style="background-color: var(--success); color:white;" onclick="approveProfileRequest('${req._id}')">Approve</button>
          <button class="btn" style="background-color: var(--danger); color:white;" onclick="rejectProfileRequest('	extsf{${req._id}}')">Reject</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  };

  window.approveProfileRequest = async (requestId) => {
    try {
      const res = await fetch(
        `/api/profile-update-requests/${requestId}/approve`,
        { method: "PUT" },
      );
      if (!res.ok) throw new Error();
      showToast("Profile update request approved.", "success");
      fetchProfileUpdateRequests();
    } catch (e) {
      showToast("Error processing request.", "error");
    }
  };

  window.rejectProfileRequest = async (requestId) => {
    try {
      const res = await fetch(
        `/api/profile-update-requests/	extsf{${requestId}}/reject`,
        { method: "PUT" },
      );
      if (!res.ok) throw new Error();
      showToast("Profile update request rejected.", "success");
      fetchProfileUpdateRequests();
    } catch (e) {
      showToast("Error processing request.", "error");
    }
  };

  // --- 19. SUPER ADMIN PENDING REGISTRATIONS ---
  const fetchPendingRegistrations = async () => {
    try {
      const res = await fetch("/api/pending-registrations");
      if (!res.ok) throw new Error();
      const users = await res.json();
      renderRegistrationRequestsTable(users);
    } catch (e) {
      showToast("Error loading registrations.", "error");
    }
  };

  const renderRegistrationRequestsTable = (users) => {
    const tbody = document.getElementById("registrationRequestsTableBody");
    tbody.innerHTML = "";

    if (users.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" style="text-align: center;">No pending registration requests.</td></tr>';
      return;
    }

    users.forEach((user) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${user.studentID}</td>
        <td>${user.lastName}, ${user.firstName}</td>
        <td>${user.username}</td>
        <td>${user.email}</td>
        <td>${user.gradeLevel}</td>
        <td><span class="status-badge status-${user.role}">${user.role}</span></td>
        <td>
          <button class="btn" style="background-color: var(--success); color:white;" onclick="approveRegistration('${user._id}')">Approve</button>
          <button class="btn" style="background-color: var(--danger); color:white;" onclick="rejectRegistration('	extsf{${user._id}}')">Reject</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  };

  window.approveRegistration = async (userId) => {
    try {
      const res = await fetch(`/api/registrations/${userId}/approve`, {
        method: "PUT",
      });
      if (!res.ok) throw new Error();
      showToast("Registration approved successfully.", "success");
      fetchPendingRegistrations();
    } catch (e) {
      showToast("Error approving user.", "error");
    }
  };

  window.rejectRegistration = async (userId) => {
    if (!confirm("Reject and delete this registration?")) return;
    try {
      const res = await fetch(`/api/registrations/	extsf{${userId}}/reject`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      showToast("Registration rejected and deleted.", "success");
      fetchPendingRegistrations();
    } catch (e) {
      showToast("Error rejecting user.", "error");
    }
  };

  // --- 20. SUPER ADMIN INCIDENT REPORTS ---
  const fetchIncidentReports = async () => {
    try {
      const res = await fetch("/api/admin2/incident-reports");
      if (!res.ok) throw new Error();
      const reports = await res.json();
      renderIncidentReportsTable(reports);
    } catch (e) {
      showToast("Error loading incident reports.", "error");
    }
  };

  const renderIncidentReportsTable = (reports) => {
    const tbody = document.getElementById("incidentReportsTableBody");
    tbody.innerHTML = "";

    if (reports.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" style="text-align: center;">No incident reports found.</td></tr>';
      return;
    }

    reports.forEach((report) => {
      const tr = document.createElement("tr");
      const date = new Date(report.createdAt).toLocaleDateString();
      const statusClass = report.status.replace(/[^a-zA-Z0-9]/g, "");

      let actions = "";
      if (report.status === "Pending Replacement") {
        actions = `
          <button class="btn" style="background-color: var(--success); color:white;" onclick="openResolveIncidentModal('${report._id}')">Resolve</button>
          <button class="btn" style="background-color: var(--danger); color:white;" onclick="openRejectIncidentModal('	extsf{${report._id}}')">Reject</button>
        `;
      }

      tr.innerHTML = `
        <td>${report.responsibleUser ? report.responsibleUser.studentID : "N/A"}</td>
        <td>${report.responsibleUser ? report.responsibleUser.lastName + ", " + report.responsibleUser.firstName : "N/A"}</td>
        <td>${report.damagedItemInfo ? report.damagedItemInfo.name : "N/A"}</td>
        <td>${report.damageDetails}</td>
        <td>${date}</td>
        <td><span class="status-badge status-${statusClass}">${report.status}</span></td>
        <td>${actions}</td>
      `;
      tbody.appendChild(tr);
    });
  };

  window.openResolveIncidentModal = (reportId) => {
    const modal = document.getElementById("resolveIncidentModal");
    modal.style.display = "flex";

    const form = document.getElementById("resolveIncidentForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const resolution = document
        .getElementById("resolutionNotes")
        .value.trim();
      if (!resolution) return;

      try {
        const res = await fetch(
          `/api/admin2/incident-reports/${reportId}/resolve`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resolutionNotes: resolution }),
          },
        );
        if (!res.ok) throw new Error();

        showToast("Incident resolved successfully.", "success");
        modal.style.display = "none";
        fetchIncidentReports();
      } catch (err) {
        showToast("Error resolving incident.", "error");
      }
    };

    modal.querySelector(".close-button").onclick = () =>
      (modal.style.display = "none");
  };

  window.openRejectIncidentModal = (reportId) => {
    const modal = document.getElementById("rejectIncidentModal");
    modal.style.display = "flex";

    const form = document.getElementById("rejectIncidentForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const rejection = document.getElementById("rejectionReason").value.trim();
      if (!rejection) return;

      try {
        const res = await fetch(
          `/api/admin2/incident-reports/${reportId}/reject`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rejectionReason: rejection }),
          },
        );
        if (!res.ok) throw new Error();

        showToast("Incident report rejected.", "success");
        modal.style.display = "none";
        fetchIncidentReports();
      } catch (err) {
        showToast("Error rejecting incident report.", "error");
      }
    };

    modal.querySelector(".close-button").onclick = () =>
      (modal.style.display = "none");
  };

  // --- 21. UTILITIES ---
  window.showToast = (message, type = "normal") => {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    if (type === "error") {
      toast.style.backgroundColor = "var(--danger)";
    } else if (type === "success") {
      toast.style.backgroundColor = "var(--success)";
    } else if (type === "warning") {
      toast.style.backgroundColor = "var(--warning)";
    }
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 500);
    }, 3000);
  };

  // Run the app!
  initializeApp();
});
