document.addEventListener("DOMContentLoaded", () => {
  // --- 1. Global State and DOM Elements ---
  const apiBaseUrl = window.location.origin;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/")) {
      return originalFetch(`${apiBaseUrl}${input}`, init);
    }
    return originalFetch(input, init);
  };
  let allEquipment = [];
  let myRequests = [];
  let notifications = [];
  let socket = null;
  let wsReconnectTimer = null;
  let realtimePollTimer = null;
  let realtimeRefreshDebounceTimer = null;
  let refreshInFlight = null;
  let lastRealtimeRefreshAt = 0;
  let isBackgroundRefresh = false;

  const body = document.body;
  const pages = {
    dashboard: document.getElementById("dashboard-content"),
    "lab-equipment": document.getElementById("lab-equipment-content"),
    "item-requested": document.getElementById("item-requested-content"),
    "report-dashboard": document.getElementById("report-dashboard-content"),
    notification: document.getElementById("notification-content"),
    account: document.getElementById("account-content"),
  };

  const logo = document.querySelector("#sidebar .logo img");
  logo.addEventListener("click", () => showPage("dashboard"));

  const logoutLink = document.querySelector('a[href="/logout"]');
  if (logoutLink) {
    logoutLink.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        // Call logout endpoint
        const response = await fetch(`${apiBaseUrl}/logout`, {
          method: "POST",
          credentials: "include",
        });
        // Explicitly redirect to index page
        window.location.replace("/");
      } catch (error) {
        // Fallback: redirect even if fetch fails
        console.error("Logout error:", error);
        window.location.replace("/");
      }
    });
  }

  const getActivePageId = () => {
    const activePage = document.querySelector(".page-content.active");
    if (!activePage || !activePage.id) return "dashboard";
    return activePage.id.replace("-content", "");
  };

  const updateLiveClock = () => {
    const clockEl = document.getElementById("liveClock");
    const dateEl = document.getElementById("liveClockDate");
    if (!clockEl || !dateEl) return;

    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
    dateEl.textContent = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const refreshRealtimeData = async ({
    force = false,
    reason = "manual",
  } = {}) => {
    const now = Date.now();
    if (!force && now - lastRealtimeRefreshAt < 1500) return;
    if (refreshInFlight) return refreshInFlight;

    const refreshStatus = document.getElementById("liveRefreshStatus");
    if (refreshStatus)
      refreshStatus.textContent = `Refreshing data (${reason})...`;

    isBackgroundRefresh = true;
    refreshInFlight = (async () => {
      try {
        const activePage = getActivePageId();
        const jobs = [
          fetchMyRequests(),
          fetchMyNotifications(),
          fetchBorrowingInfo(),
        ];

        if (activePage === "lab-equipment") {
          jobs.push(fetchAllEquipment());
        }
        if (activePage === "report-dashboard") {
          jobs.push(fetchPendingReports());
          jobs.push(checkSuspensionStatus());
        }

        await Promise.all(
          jobs.map((job) => Promise.resolve(job).catch(() => null)),
        );
        updateDashboardMetrics();
        lastRealtimeRefreshAt = Date.now();
        if (refreshStatus) {
          refreshStatus.textContent = `Last synced: ${new Date().toLocaleTimeString("en-US")}`;
        }
      } finally {
        isBackgroundRefresh = false;
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  };

  const scheduleRealtimeRefresh = (reason = "event") => {
    if (realtimeRefreshDebounceTimer)
      clearTimeout(realtimeRefreshDebounceTimer);
    realtimeRefreshDebounceTimer = setTimeout(() => {
      refreshRealtimeData({ reason });
    }, 250);
  };

  const connectWebSocket = () => {
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${wsProtocol}://${window.location.host}`);

    socket.onopen = () => {
      console.log("Connected to WebSocket server");
      const refreshStatus = document.getElementById("liveRefreshStatus");
      if (refreshStatus) refreshStatus.textContent = "Live updates connected.";
      scheduleRealtimeRefresh("socket-open");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "refresh") {
          scheduleRealtimeRefresh("websocket");
        }
      } catch (err) {
        console.error("WebSocket message error:", err);
      }
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    socket.onclose = () => {
      const refreshStatus = document.getElementById("liveRefreshStatus");
      if (refreshStatus)
        refreshStatus.textContent = "Live updates reconnecting...";
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };
  };

  const startRealtimePolling = () => {
    if (realtimePollTimer) clearInterval(realtimePollTimer);
    realtimePollTimer = setInterval(() => {
      if (!document.hidden) refreshRealtimeData({ reason: "poll" });
    }, 15000);
  };

  const equipmentTableBody = document.getElementById("equipmentTableBody");
  const requestsTableBody = document.getElementById("requestsTableBody");
  const notificationList = document.getElementById("notification-list");
  const notificationBadge = document.getElementById("notification-badge");
  const darkToggle = document.querySelector(".dark-toggle");

  const requestModal = document.getElementById("requestModal");
  const modalItemName = document.getElementById("modalItemName");
  const modalItemId = document.getElementById("modalItemId");
  const requestForm = document.getElementById("requestForm");

  const equipmentSearch = document.getElementById("equipmentSearch");
  const categoryButtonsContainer = document.getElementById("categoryButtons");
  const statusFilter = document.getElementById("statusFilter");
  const locationFilter = document.getElementById("locationFilter");
  const actionFilter = document.getElementById("actionFilter");

  const requestSearch = document.getElementById("requestSearch");
  const requestStatusFilter = document.getElementById("requestStatusFilter");

  const profileUpdateForm = document.getElementById("profileUpdateForm");
  const passwordUpdateForm = document.getElementById("passwordUpdateForm");

  function sanitizeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCurrency(value = 0, currency = "PHP") {
    const amount = Number(value || 0);
    return `${currency} ${amount.toFixed(2)}`;
  }

  function getBaseItemId(item) {
    const rawId = item?.itemId || "";
    const match = rawId.match(/^(.+?)(-\d+)?$/);
    if (match && match[2]) return match[1];
    return rawId || item?.name || "UNASSIGNED";
  }

  function toggleEquipmentGroup(groupId, shouldExpand, triggerEl) {
    if (!equipmentTableBody) return;
    const detailRows = Array.from(
      equipmentTableBody.querySelectorAll(".equipment-detail-row"),
    ).filter((row) => row.dataset.group === groupId);
    if (detailRows.length === 0) return;

    detailRows.forEach((row) => {
      row.style.display = shouldExpand ? "table-row" : "none";
    });

    if (triggerEl) {
      triggerEl.setAttribute("aria-expanded", shouldExpand);
      const arrowIcon = triggerEl.querySelector(".arrow-icon");
      if (arrowIcon) {
        arrowIcon.textContent = shouldExpand ? "▲" : "▼";
      }
    }
  }

  function handleEquipmentTableClick(event) {
    const toggleButton = event.target.closest(".equipment-group-toggle");
    if (!toggleButton || !toggleButton.dataset.group) return;
    const groupId = toggleButton.dataset.group;
    const isExpanded = toggleButton.getAttribute("aria-expanded") === "true";
    toggleEquipmentGroup(groupId, !isExpanded, toggleButton);
  }

  if (equipmentTableBody) {
    equipmentTableBody.addEventListener("click", handleEquipmentTableClick);
  }

  // --- 2. Initialization & Event Handling ---
  const initializeApp = async () => {
    setupDarkMode();
    updateLiveClock();
    setInterval(updateLiveClock, 1000);
    // Set welcome date
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
    await fetchCurrentUser();
    setupEventListeners();
    await fetchMyRequests();
    await fetchMyNotifications();
    await checkSuspensionStatus();
    showPage("dashboard");
    connectWebSocket();
    startRealtimePolling();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshRealtimeData({ force: true, reason: "tab-visible" });
      }
    });

    window.addEventListener("focus", () => {
      refreshRealtimeData({ reason: "window-focus" });
    });
  };

  const setupEventListeners = () => {
    document.querySelectorAll("#sidebar nav a[data-page]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        showPage(link.dataset.page);
      });
    });

    categoryButtonsContainer.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") {
        categoryButtonsContainer
          .querySelector(".active")
          ?.classList.remove("active");
        e.target.classList.add("active");
        renderEquipmentTable();
      }
    });

    equipmentSearch.addEventListener("input", renderEquipmentTable);
    statusFilter.addEventListener("change", renderEquipmentTable);
    locationFilter.addEventListener("change", renderEquipmentTable);
    actionFilter.addEventListener("change", renderEquipmentTable);

    requestSearch.addEventListener("input", renderRequestsTable);
    requestStatusFilter.addEventListener("change", renderRequestsTable);

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
    });

    document.querySelectorAll(".modal-close-btn").forEach((button) => {
      button.addEventListener("click", () => {
        closeModal();
      });
    });

    requestModal.addEventListener("click", (e) => {
      if (e.target === requestModal) {
        closeModal();
      }
    });

    requestForm.addEventListener("submit", handleRequestFormSubmit);
    profileUpdateForm.addEventListener("submit", handleProfileUpdate);
    passwordUpdateForm.addEventListener("submit", handlePasswordUpdate);
  };

  const setupDarkMode = () => {
    const isDarkMode = localStorage.getItem("dark-mode") === "true";
    if (isDarkMode) {
      body.classList.add("dark");
    }
    darkToggle.querySelector(".sun-icon").style.display = isDarkMode
      ? "none"
      : "block";
    darkToggle.querySelector(".moon-icon").style.display = isDarkMode
      ? "block"
      : "none";
  };

  // --- 3. Page Rendering and Data Fetching ---
  window.showPage = (pageId) => {
    document
      .querySelectorAll(".page-content")
      .forEach((p) => p.classList.remove("active"));
    document
      .querySelectorAll("#sidebar nav a[data-page]")
      .forEach((l) => l.classList.toggle("active", l.dataset.page === pageId));
    pages[pageId].classList.add("active");

    switch (pageId) {
      case "lab-equipment":
        fetchAllEquipment();
        break;
      case "item-requested":
        fetchMyRequests();
        break;
      case "dashboard":
        updateDashboardMetrics();
        break;

      case "report-dashboard":
        fetchPendingReports();
        checkSuspensionStatus();
        break;
      case "notification":
        fetchMyNotifications().then(() => {
          renderNotifications();
          markNotificationsAsRead();
        });
        break;
    }
  };

  const fetchCurrentUser = async () => {
    try {
      const response = await fetch("/api/current-user");
      if (!response.ok) throw new Error("Session expired");
      const currentUser = await response.json();

      document.getElementById("studentName").textContent = currentUser.fullName;
      document.getElementById("profileFirstName").value = currentUser.firstName;
      document.getElementById("profileLastName").value = currentUser.lastName;
      document.getElementById("profileEmail").value = currentUser.email;
      document.getElementById("profileUsername").value = currentUser.username;
      document.getElementById("profileStudentID").value = currentUser.studentID;
      document.getElementById("profileGradeLevel").value =
        currentUser.gradeLevel;
    } catch (error) {
      console.error("Error fetching user data:", error);
      showToast("Session expired. Please log in again.");
      setTimeout(() => (window.location.href = "/"), 1500);
    }
  };

  const fetchAllEquipment = async () => {
    console.log("Fetching all equipment...");
    try {
      const response = await fetch("/api/all-inventory");
      if (!response.ok) throw new Error("Failed to load equipment.");
      allEquipment = await response.json();

      populateFilters();
      renderEquipmentTable();
    } catch (error) {
      if (!isBackgroundRefresh) showToast("Failed to load equipment.");
      console.error("Error fetching all inventory:", error);
    }
  };

  const fetchMyRequests = async () => {
    try {
      const response = await fetch("/api/my-requests");
      if (!response.ok) throw new Error("Failed to load your requests.");
      myRequests = await response.json();
      renderRequestsTable();
      updateDashboardMetrics();
    } catch (error) {
      if (!isBackgroundRefresh) showToast("Failed to load your requests.");
      console.error("Error fetching my requests:", error);
    }
  };

  const updateDashboardMetrics = () => {
    const borrowed = myRequests.filter((r) => r.status === "Approved").length;
    const pending = myRequests.filter((r) => r.status === "Pending").length;
    const returned = myRequests.filter((r) => r.status === "Returned").length;

    // Calculate overdue items (Approved requests past due date)
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const overdue = myRequests.filter((r) => {
      if (r.status !== "Approved" || !r.dueDate) return false;
      const dueDate = new Date(r.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate < now;
    }).length;

    // Calculate items due in next 3 days
    const threeDaysFromNow = new Date(now);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const dueSoon = myRequests.filter((r) => {
      if (r.status !== "Approved" || !r.dueDate) return false;
      const dueDate = new Date(r.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate >= now && dueDate <= threeDaysFromNow;
    }).length;

    document.getElementById("borrowedCount").textContent = borrowed;
    document.getElementById("pendingCount").textContent = pending;
    document.getElementById("returnedCount").textContent = returned;
    document.getElementById("overdueCount").textContent = overdue;
    document.getElementById("dueSoonCount").textContent = dueSoon;

    // Sync quick stats
    const qsBorrowed = document.getElementById("qsBorrowed");
    const qsPending = document.getElementById("qsPending");
    const qsReturned = document.getElementById("qsReturned");
    const qsOverdue = document.getElementById("qsOverdue");
    if (qsBorrowed) qsBorrowed.textContent = borrowed;
    if (qsPending) qsPending.textContent = pending;
    if (qsReturned) qsReturned.textContent = returned;
    if (qsOverdue) qsOverdue.textContent = overdue;

    // Update upcoming deadlines list
    renderUpcomingDeadlines();
    renderDueCalendar();

    // Update all-time returns (same as returned count for now)
    document.getElementById("allTimeReturnsCount").textContent = returned;
  };

  const renderDueCalendar = () => {
    const grid = document.getElementById("due-calendar-grid");
    if (!grid) return;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const dueCountByDay = new Map();
    myRequests
      .filter((r) => r.status === "Approved" && r.dueDate)
      .forEach((r) => {
        const dueDate = new Date(r.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        const key = dueDate.toISOString().split("T")[0];
        dueCountByDay.set(key, (dueCountByDay.get(key) || 0) + 1);
      });

    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(now);
      day.setDate(now.getDate() + index);
      return day;
    });

    grid.innerHTML = days
      .map((day) => {
        const key = day.toISOString().split("T")[0];
        const count = dueCountByDay.get(key) || 0;
        const classes = ["due-day-card", count > 0 ? "has-due" : ""]
          .filter(Boolean)
          .join(" ");

        return `
                <div class="${classes}">
                  <div class="due-day-label">${day.toLocaleDateString("en-US", {
                    weekday: "short",
                  })}</div>
                  <div class="due-day-date">${day.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}</div>
                  <div class="due-day-count">${count > 0 ? `${count} due` : "No due"}</div>
                </div>
              `;
      })
      .join("");
  };

  const renderUpcomingDeadlines = () => {
    const deadlinesList = document.getElementById("upcoming-deadlines-list");
    if (!deadlinesList) return;

    // Get all approved requests with due dates
    const approvedRequests = myRequests
      .filter((r) => r.status === "Approved" && r.dueDate)
      .map((r) => ({
        ...r,
        dueDateObj: new Date(r.dueDate),
      }))
      .sort((a, b) => a.dueDateObj - b.dueDateObj);

    if (approvedRequests.length === 0) {
      deadlinesList.innerHTML =
        '<p style="color: var(--text-subtle);">No upcoming deadlines.</p>';
      return;
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    deadlinesList.innerHTML = approvedRequests
      .map((req) => {
        const dueDate = req.dueDateObj;
        dueDate.setHours(0, 0, 0, 0);
        const daysDiff = Math.floor((dueDate - now) / (1000 * 60 * 60 * 24));

        let statusClass = "upcoming";
        let statusText = "";

        if (daysDiff < 0) {
          statusClass = "overdue";
          statusText = "OVERDUE";
        } else if (daysDiff <= 3) {
          statusClass = "due-soon";
          statusText = "DUE SOON";
        } else {
          statusText = dueDate.toLocaleDateString("en-US", {
            month: "2-digit",
            day: "2-digit",
            year: "numeric",
          });
        }

        const safeItemName = sanitizeHtml(
          req.itemName || req.itemId || "Unknown Item",
        );

        return `
                <div class="deadline-item">
                  <span class="deadline-item-name">${safeItemName}</span>
                  <span class="deadline-status ${statusClass}">${statusText}</span>
                </div>
              `;
      })
      .join("");
  };

  // --- 4. UI Rendering & Filtering ---
  const populateFilters = () => {
    const categories = [
      "All",
      ...new Set(allEquipment.map((item) => item.category)),
    ];
    categoryButtonsContainer.innerHTML = categories
      .map(
        (cat) =>
          `<button class="btn btn-category ${
            cat === "All" ? "active" : ""
          }" data-category="${cat}">${cat}</button>`,
      )
      .join("");

    const locations = [
      "All",
      ...new Set(allEquipment.map((item) => item.location)),
    ];
    locationFilter.innerHTML = locations
      .map(
        (loc) =>
          `<option value="${loc}">${
            loc === "All" ? "All Locations" : loc
          }</option>`,
      )
      .join("");
  };

  const renderEquipmentTable = () => {
    const searchTerm = equipmentSearch.value.toLowerCase();
    const activeCategory =
      categoryButtonsContainer.querySelector(".active")?.dataset.category ||
      "All";
    const currentStatus = statusFilter.value;
    const currentLocation = locationFilter.value;
    const currentAction = actionFilter.value;

    const filtered = allEquipment.filter((item) => {
      const matchesCategory =
        activeCategory === "All" || item.category === activeCategory;
      const matchesSearch = Object.values(item).some((val) =>
        String(val).toLowerCase().includes(searchTerm),
      );
      const matchesStatus =
        currentStatus === "All" || item.status === currentStatus;
      const matchesLocation =
        currentLocation === "All" || item.location === currentLocation;

      let matchesAction = true;
      if (currentAction !== "All") {
        const isRequestable = item.status === "Available" && item.quantity > 0;
        matchesAction =
          currentAction === "Requestable" ? isRequestable : !isRequestable;
      }

      return (
        matchesCategory &&
        matchesSearch &&
        matchesStatus &&
        matchesLocation &&
        matchesAction
      );
    });

    equipmentTableBody.innerHTML = "";
    if (filtered.length === 0) {
      equipmentTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem;">No equipment matches your filters.</td></tr>`;
      return;
    }

    const groupedMap = new Map();
    filtered.forEach((item, index) => {
      const baseId = getBaseItemId(item);
      const key = `${baseId}__${item.name || ""}` || `UNASSIGNED-${index}`;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          baseId,
          name: item.name || baseId,
          category: item.category || "Uncategorized",
          items: [],
        });
      }
      groupedMap.get(key).items.push(item);
    });

    groupedMap.forEach((group, key) => {
      const groupItems = [...group.items].sort((a, b) =>
        (a.itemId || "").localeCompare(b.itemId || ""),
      );
      const aggregatedAvailable = groupItems.reduce(
        (sum, current) => sum + Math.max(Number(current.quantity) || 0, 0),
        0,
      );
      const groupStatus = deriveGroupStatus(groupItems, aggregatedAvailable);
      renderEquipmentSummaryRow({
        groupId: key,
        baseId: group.baseId,
        name: group.name,
        category: group.category,
        locationLabel: deriveGroupLocation(groupItems),
        statusText: groupStatus.text,
        statusClass: groupStatus.className,
        itemCount: groupItems.length,
        aggregatedAvailable,
        primaryItemId: groupItems[0]?.itemId || group.baseId,
        price: groupItems[0]?.price || 0,
      });

      groupItems.forEach((item, index) => {
        renderEquipmentDetailRow(item, {
          groupId: key,
          displayLabel:
            item.itemId ||
            `${group.baseId}-${String(index + 1).padStart(2, "0")}`,
        });
      });
    });
  };

  function deriveGroupStatus(items, aggregatedAvailable) {
    const normalizedStatuses = items.map((item) =>
      (item.status || "Available").trim(),
    );
    if (aggregatedAvailable > 0) {
      return {
        text: `Available (${aggregatedAvailable})`,
        className: "status-Available",
      };
    }
    if (normalizedStatuses.some((status) => status === "Maintenance")) {
      return { text: "Maintenance", className: "status-Maintenance" };
    }
    if (normalizedStatuses.some((status) => status === "In-Use")) {
      return { text: "In-Use", className: "status-In-Use" };
    }
    if (normalizedStatuses.some((status) => status === "Damaged")) {
      return { text: "Damaged", className: "status-Damaged" };
    }
    return { text: "Unavailable", className: "status-Unavailable" };
  }

  function deriveGroupLocation(items) {
    const uniqueLocations = [
      ...new Set(items.map((item) => item.location || "Unspecified Location")),
    ];
    return uniqueLocations.length === 1
      ? uniqueLocations[0]
      : "Multiple Locations";
  }

  function renderEquipmentSummaryRow({
    groupId,
    baseId,
    name,
    category,
    locationLabel,
    statusText,
    statusClass,
    itemCount,
    aggregatedAvailable,
    primaryItemId,
    price,
  }) {
    const row = equipmentTableBody.insertRow();
    row.classList.add("equipment-summary-row");
    row.dataset.group = groupId;

    const safeBaseId = sanitizeHtml(baseId);
    const safeName = sanitizeHtml(name);
    const safeCategory = sanitizeHtml(category);
    const safeLocation = sanitizeHtml(locationLabel);
    const safeStatusText = sanitizeHtml(statusText);
    const safePrimaryId = sanitizeHtml(primaryItemId);
    const safeGroupAttr = sanitizeHtml(groupId);
    const itemCountBadge =
      itemCount > 1
        ? `<span class="equipment-group-count">+${itemCount - 1}</span>`
        : "";

    const toggleControl =
      itemCount > 1
        ? `<button class="equipment-group-toggle" data-group="${safeGroupAttr}" aria-expanded="false" title="Show all ${safeBaseId} entries">
                    <span class="arrow-icon">▼</span>
                 </button>`
        : '<span class="equipment-toggle-placeholder"></span>';

    row.innerHTML = `
            <td>
              ${toggleControl}
              <strong>${safeBaseId}</strong>
              <span class="equipment-group-subtitle">(${safeName})</span>
              ${itemCountBadge}
            </td>
            <td>${safeName}</td>
            <td>${safeCategory}</td>
            <td>${safeLocation}</td>
            <td>₱${price ? parseFloat(price).toFixed(2) : "0.00"}</td>
            <td><span class="${statusClass}">${safeStatusText}</span></td>
            <td>
              <button class="btn btn-request" ${
                aggregatedAvailable > 0 ? "" : "disabled"
              } onclick="showRequestModal('${safePrimaryId}', '${safeName}', ${aggregatedAvailable})">
                ${aggregatedAvailable > 0 ? "Request" : "Unavailable"}
              </button>
            </td>
          `;
  }

  function renderEquipmentDetailRow(
    item,
    { groupId, displayLabel = item.itemId || "" } = {},
  ) {
    if (!equipmentTableBody) return;

    const row = equipmentTableBody.insertRow();
    row.dataset.group = groupId;
    row.classList.add("equipment-detail-row");
    row.style.display = "none";

    const safeItemId = sanitizeHtml(item.itemId || "");
    const safeDisplayId = sanitizeHtml(displayLabel);
    const safeName = sanitizeHtml(item.name || "");
    const safeCategory = sanitizeHtml(item.category || "");
    const safeLocation = sanitizeHtml(item.location || "");
    const rawStatus = item.status || "Available";
    const statusClass = rawStatus.replace(/\s+/g, "");
    const safeStatus = sanitizeHtml(rawStatus);
    const quantity = Number(item.quantity) || 0;
    const statusLabel =
      rawStatus === "Available" ? `${safeStatus} (${quantity})` : safeStatus;
    const isAvailable = rawStatus === "Available" && quantity > 0;

    row.innerHTML = `
            <td>
              <span class="equipment-toggle-placeholder"></span>
              <strong>${safeDisplayId}</strong>
            </td>
            <td>${safeName}</td>
            <td>${safeCategory}</td>
            <td>${safeLocation}</td>
            <td>₱${item.price ? parseFloat(item.price).toFixed(2) : "0.00"}</td>
            <td><span class="status-${statusClass}">${statusLabel}</span></td>
            <td>
              <button class="btn btn-request" ${
                isAvailable ? "" : "disabled"
              } onclick="showRequestModal('${safeItemId}', '${safeName}', ${quantity})">
                ${isAvailable ? "Request" : "Unavailable"}
              </button>
            </td>
          `;
  }

  const renderRequestsTable = () => {
    const searchTerm = requestSearch.value.toLowerCase();
    const currentStatus = requestStatusFilter.value;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const pastDueCount = myRequests.filter((req) => {
      const dueDate = req.dueDate ? new Date(req.dueDate) : null;
      if (!dueDate) return false;
      dueDate.setHours(0, 0, 0, 0);
      return req.status === "Approved" && dueDate < now;
    }).length;

    const pastDueOption = document.getElementById("pastDueOption");
    if (pastDueOption) {
      pastDueOption.textContent = `Past Due (${pastDueCount})`;
    }

    let filtered = myRequests.filter((req) => {
      const matchesSearch =
        req.itemName.toLowerCase().includes(searchTerm) ||
        req.itemId.toLowerCase().includes(searchTerm);
      let matchesStatus;
      if (currentStatus === "PastDue") {
        const dueDate = req.dueDate ? new Date(req.dueDate) : null;
        if (dueDate) dueDate.setHours(0, 0, 0, 0);
        matchesStatus = req.status === "Approved" && dueDate && dueDate < now;
      } else {
        matchesStatus = currentStatus === "All" || req.status === currentStatus;
      }
      return matchesSearch && matchesStatus;
    });

    requestsTableBody.innerHTML = "";
    if (filtered.length === 0) {
      requestsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">No requests match your filters.</td></tr>`;
      return;
    }
    filtered
      .sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate))
      .forEach((req) => {
        const row = requestsTableBody.insertRow();
        const startDate = req.startDate
          ? new Date(req.startDate).toLocaleDateString()
          : "N/A";
        const dueDate = req.dueDate
          ? new Date(req.dueDate).toLocaleDateString()
          : "N/A";
        const dueDateObj = req.dueDate ? new Date(req.dueDate) : null;
        if (dueDateObj) dueDateObj.setHours(0, 0, 0, 0);
        const isPastDue =
          req.status === "Approved" && dueDateObj && dueDateObj < now;
        const displayStatus = isPastDue ? "Past Due" : req.status;
        const statusClass = isPastDue
          ? "status-PastDue"
          : `status-${req.status.replace(/\s+/g, "")}`;

        if (isPastDue) {
          row.classList.add("row-past-due");
        }

        row.innerHTML = `
                        <td><strong>${req.itemId}</strong></td><td>${
                          req.itemName
                        }</td><td>${startDate}</td>
                        <td>${dueDate}</td><td><span class="status-badge ${statusClass}">${
                          displayStatus
                        }</span></td>
                        <td>
                            ${
                              req.status === "Pending"
                                ? `<button class="btn btn-cancel" onclick="cancelRequest('${req._id}')">Cancel</button>`
                                : "—"
                            }
                        </td>
                    `;
      });
  };

  const updateNotificationBadge = () => {
    const unreadCount = notifications.filter((n) => !n.isRead).length;
    notificationBadge.textContent = unreadCount;
    notificationBadge.style.display = unreadCount > 0 ? "inline-block" : "none";
  };

  const fetchMyNotifications = async () => {
    try {
      const response = await fetch("/api/my-notifications");
      if (!response.ok) throw new Error("Could not fetch notifications.");
      notifications = await response.json();
      updateNotificationBadge();
      // Render notifications if the notification page is currently active
      if (
        document
          .getElementById("notification-content")
          .classList.contains("active")
      ) {
        renderNotifications();
      }
    } catch (error) {
      console.error(error);
      if (!isBackgroundRefresh) showToast(error.message);
      // Show error in notification list if page is active
      if (
        document
          .getElementById("notification-content")
          .classList.contains("active")
      ) {
        const notificationList = document.getElementById("notification-list");
        if (notificationList) {
          notificationList.innerHTML = `<p style="color: var(--text-subtle);">Error: ${
            error.message || "Failed to load notifications."
          }</p>`;
        }
      }
    }
  };

  const renderNotifications = () => {
    if (!notificationList) {
      console.error("Notification list element not found");
      return;
    }
    notificationList.innerHTML = "";

    if (!notifications || notifications.length === 0) {
      notificationList.innerHTML = "<p>You have no new notifications.</p>";
      return;
    }

    const sortedNotifications = notifications.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );

    sortedNotifications.forEach((n) => {
      const item = document.createElement("div");
      item.className = "notification-item";
      item.innerHTML = `
                            <div class="notification-title">${sanitizeHtml(
                              n.title || "No Title",
                            )}</div>
                            <div class="notification-message">${sanitizeHtml(
                              n.message || "No message",
                            )}</div>
                            <div class="notification-time">${
                              n.createdAt
                                ? new Date(n.createdAt).toLocaleString()
                                : "Unknown date"
                            }</div>
                            <div class="notification-actions">
                                <button class="btn-delete-notification" onclick="deleteNotification('${
                                  n._id
                                }')">Delete</button>
                            </div>
                        `;
      notificationList.appendChild(item);
    });
  };

  window.deleteNotification = async (notificationId) => {
    if (!confirm("Are you sure you want to delete this notification?")) return;
    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (jsonError) {
        throw new Error(text || "Failed to parse server response");
      }

      if (!response.ok) {
        throw new Error(result.message || "Failed to delete notification.");
      }

      showToast(
        result.message || "Notification deleted successfully.",
        "success",
      );
      // Remove from local array
      notifications = notifications.filter((n) => n._id !== notificationId);
      renderNotifications();
      updateNotificationBadge();
    } catch (error) {
      showToast(`Error: ${error.message}`, "error");
      console.error("Delete notification error:", error);
    }
  };

  const markNotificationsAsRead = async () => {
    try {
      await fetch("/api/notifications/mark-read", { method: "POST" });
      notifications.forEach((n) => (n.isRead = true));
      updateNotificationBadge();
    } catch (error) {
      console.error("Failed to mark notifications as read:", error);
    }
  };

  // --- 5. Modal & API Interaction Functions ---
  const openModal = () => {
    const modalContent = requestModal.querySelector(".modal-content");
    requestModal.style.display = "grid";
    setTimeout(() => {
      requestModal.style.opacity = "1";
      modalContent.style.transform = "scale(1)";
    }, 10);
  };

  const closeModal = () => {
    const modalContent = requestModal.querySelector(".modal-content");
    requestModal.style.opacity = "0";
    modalContent.style.transform = "scale(0.95)";
    setTimeout(() => {
      requestModal.style.display = "none";
      requestForm.reset();
    }, 300);
  };

  const isWeekend = (dateString) => {
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6; // 0 = Sunday, 6 = Saturday
  };

  const validateDateInput = (inputElement, fieldName) => {
    const dateValue = inputElement.value;
    if (dateValue && isWeekend(dateValue)) {
      showToast(
        `${fieldName} cannot be a Saturday or Sunday. Please select a weekday.`,
        "error",
      );
      inputElement.value = "";
      inputElement.focus();
      return false;
    }
    return true;
  };

  window.showRequestModal = (itemId, itemName, maxQuantity) => {
    modalItemId.value = itemId;
    modalItemName.textContent = itemName;
    const qtyInput = document.getElementById("requestQuantity");
    qtyInput.max = maxQuantity;
    qtyInput.placeholder = `Max available: ${maxQuantity}`;

    // Fetch borrowing info for the modal
    fetchBorrowingInfo();

    const today = new Date().toISOString().split("T")[0];
    const startDateInput = document.getElementById("startDate");
    const dueDateInput = document.getElementById("dueDate");

    startDateInput.min = today;
    dueDateInput.min = today;

    // Add weekend validation on change
    startDateInput.onchange = () => {
      if (validateDateInput(startDateInput, "Start Date")) {
        // Update due date min to be at least start date (only if start date is valid)
        if (startDateInput.value) {
          dueDateInput.min = startDateInput.value;
          // If due date is already set and is now before start date, clear it
          if (
            dueDateInput.value &&
            new Date(dueDateInput.value) < new Date(startDateInput.value)
          ) {
            dueDateInput.value = "";
          }
        }
      }
    };

    dueDateInput.onchange = () => {
      validateDateInput(dueDateInput, "Due Date");
    };

    openModal();
  };

  const handleRequestFormSubmit = async (e) => {
    e.preventDefault();

    const itemId = requestForm.elements["modalItemId"].value;
    const itemName = modalItemName.textContent;
    const quantity = parseInt(requestForm.elements["quantity"].value, 10);
    const startDate = requestForm.elements["startDate"].value;
    const dueDate = requestForm.elements["dueDate"].value;
    const reason = requestForm.elements["reason"].value;

    const itemCategory = allEquipment.find(
      (item) => item.itemId === itemId,
    )?.category;

    // Validate weekends
    if (isWeekend(startDate)) {
      showToast(
        "Start Date cannot be a Saturday or Sunday. Please select a weekday.",
        "error",
      );
      return;
    }

    if (isWeekend(dueDate)) {
      showToast(
        "Due Date cannot be a Saturday or Sunday. Please select a weekday.",
        "error",
      );
      return;
    }

    if (new Date(startDate) > new Date(dueDate)) {
      showToast("Start Date cannot be after Due Date.");
      return;
    }

    try {
      const response = await fetch("/api/request-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          itemName,
          quantity,
          startDate,
          dueDate,
          reason,
          category: itemCategory,
        }),
      });

      if (!response.ok) {
        // Try to parse JSON error message
        let errorMessage = "Failed to submit request.";
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          // If JSON parsing fails, try text
          const errorText = await response.text();
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.message || errorText || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
        }

        // Show error notification with the actual message
        showToast(errorMessage, "error");
        console.error("Request submission error:", errorMessage);

        // If it's a suspension or accountability issue, refresh suspension status
        if (
          errorMessage.includes("suspended") ||
          errorMessage.includes("accountability") ||
          errorMessage.includes("pending")
        ) {
          await checkSuspensionStatus();
          // Redirect to report dashboard if there's a pending incident
          if (
            errorMessage.includes("accountability") ||
            errorMessage.includes("pending")
          ) {
            setTimeout(() => {
              showPage("report-dashboard");
              showToast(
                "Please check your Report Dashboard for pending incident reports.",
                "warning",
              );
            }, 2000);
          }
        }
        return;
      }

      const result = await response.json().catch(() => ({}));
      showToast("Request sent successfully!", "success");
      closeModal();
      await fetchAllEquipment();
      await fetchMyRequests();
      updateDashboardMetrics();
    } catch (error) {
      showToast(`Error: ${error.message || "Failed to submit request."}`);
      console.error("Error submitting request:", error);
    }
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    const updatedProfile = {
      firstName: document.getElementById("profileFirstName").value,
      lastName: document.getElementById("profileLastName").value,
      email: document.getElementById("profileEmail").value,
    };

    try {
      const response = await fetch("/api/account/request-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedProfile),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || "Failed to submit request.");
      showToast(result.message);
    } catch (error) {
      showToast(`Error: ${error.message}`);
    }
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match.");
      return;
    }

    try {
      const response = await fetch("/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const resultText = await response.text();
      if (!response.ok)
        throw new Error(resultText || "Failed to update password.");
      showToast("Password updated successfully!");
      passwordUpdateForm.reset();
    } catch (error) {
      showToast(`Error: ${error.message}`);
    }
  };

  window.cancelRequest = async (requestId) => {
    if (!confirm("Are you sure you want to cancel this request?")) return;
    try {
      const response = await fetch(`/api/cancel-request/${requestId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await response.text());
      showToast("Request cancelled.");
      await fetchAllEquipment();
      await fetchMyRequests();
      updateDashboardMetrics();
    } catch (error) {
      showToast(`Error: ${error.message}`);
      console.error("Error cancelling request:", error);
    }
  };

  // --- 6. Utility Functions ---
  const showToast = (message, type = "info") => {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    }, 10);
    // Show error/warning toasts longer
    const duration = type === "error" || type === "warning" ? 5000 : 3000;
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 500);
    }, duration);
  };

  // --- 7. Incident Report Functions ---
  let countdownInterval = null;
  let currentReport = null;

  const fetchPendingReports = async () => {
    try {
      const response = await fetch("/api/student-incident-reports");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to load reports.");
      }
      const reports = await response.json();

      // Handle case where reports is not an array
      if (!Array.isArray(reports)) {
        console.error("Invalid response format:", reports);
        throw new Error("Invalid response format from server.");
      }

      const pendingReports = reports.filter(
        (r) =>
          r.status === "Pending Submission" ||
          r.status === "Submitted" ||
          r.status === "Pending Review" ||
          r.status === "Rejected",
      );

      const pendingList = document.getElementById("pending-reports-list");
      if (pendingReports.length === 0) {
        pendingList.innerHTML =
          '<p style="color: var(--text-subtle);">No pending reports.</p>';
        document.getElementById("incident-report-form").style.display = "none";
        // Hide and clear countdown timer when no pending reports
        const countdownTimer = document.getElementById("countdown-timer");
        if (countdownTimer) {
          countdownTimer.style.display = "none";
        }
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        return;
      }

      const mostUrgent =
        pendingReports.find((r) => r.status === "Pending Submission") ||
        pendingReports.find((r) => r.status === "Rejected") ||
        pendingReports[0];
      currentReport = mostUrgent;

      if (
        mostUrgent.status === "Pending Submission" ||
        mostUrgent.status === "Rejected"
      ) {
        // Safely access incidentId - handle both populated object and ID string
        const incidentIdValue = mostUrgent.incidentId
          ? typeof mostUrgent.incidentId === "object"
            ? mostUrgent.incidentId._id || mostUrgent.incidentId
            : mostUrgent.incidentId
          : null;

        document.getElementById("report-incident-id").value =
          incidentIdValue || "";
        document.getElementById("report-id").value = mostUrgent._id;
        document.getElementById("equipmentId").value =
          mostUrgent.equipmentId || "";
        document.getElementById("dateOfIncident").value =
          mostUrgent.dateOfIncident
            ? new Date(mostUrgent.dateOfIncident).toISOString().split("T")[0]
            : "";
        document.getElementById("incidentType").value =
          mostUrgent.incidentType || "";
        document.getElementById("detailedDescription").value =
          mostUrgent.detailedDescription === "Pending student submission"
            ? ""
            : mostUrgent.detailedDescription || "";
        document.getElementById("otherDescription").value =
          mostUrgent.otherDescription || "";
        document.getElementById("damageDescription").value =
          mostUrgent.damageDescription || "";
        document.getElementById("replacedItems").value =
          mostUrgent.replacedItems || "";
        document.getElementById("replacementAction").value =
          mostUrgent.replacementAction || "";

        if (mostUrgent.incidentType === "Other") {
          document.getElementById("other-description-group").style.display =
            "block";
        } else {
          document.getElementById("other-description-group").style.display =
            "none";
        }

        // Show countdown timer
        const countdownTimer = document.getElementById("countdown-timer");
        if (countdownTimer) {
          countdownTimer.style.display = "block";
        }

        if (mostUrgent.deadlineAt) {
          startCountdown(new Date(mostUrgent.deadlineAt));
        } else {
          // Hide countdown if no deadline
          if (countdownTimer) {
            countdownTimer.style.display = "none";
          }
        }

        // Show a message for rejected reports
        if (mostUrgent.status === "Rejected") {
          const formTitle = document.querySelector(
            "#report-dashboard-content h2:last-of-type",
          );
          if (formTitle && !formTitle.textContent.includes("Resubmit")) {
            formTitle.textContent = "Resubmit Incident Report";
          }
          // Show rejection reason if available
          if (mostUrgent.admin2ReviewNotes) {
            const warningDiv = document.querySelector(
              "#report-dashboard-content .content-container:last-of-type",
            );
            if (warningDiv) {
              let rejectionNotice =
                warningDiv.querySelector(".rejection-notice");
              if (!rejectionNotice) {
                rejectionNotice = document.createElement("div");
                rejectionNotice.className = "rejection-notice";
                rejectionNotice.style.cssText =
                  "padding: 1rem; background-color: #fee2e2; border-left: 4px solid #ef4444; border-radius: 8px; margin-bottom: 1.5rem;";
                warningDiv.insertBefore(rejectionNotice, warningDiv.firstChild);
              }
              rejectionNotice.innerHTML = `
                      <strong style="color: #991b1b">Previous Report Rejected</strong>
                      <p style="margin-top: 0.5rem; color: #991b1b; margin-bottom: 0">
                        <strong>Rejection Reason:</strong> ${mostUrgent.admin2ReviewNotes}
                      </p>
                      <p style="margin-top: 0.5rem; color: #991b1b; margin-bottom: 0">
                        Please review and resubmit your incident report with the necessary corrections.
                      </p>
                    `;
            }
          }
        } else {
          const formTitle = document.querySelector(
            "#report-dashboard-content h2:last-of-type",
          );
          if (formTitle) {
            formTitle.textContent = "Submit Incident Report";
          }
          const rejectionNotice = document.querySelector(".rejection-notice");
          if (rejectionNotice) {
            rejectionNotice.remove();
          }
        }

        document.getElementById("incident-report-form").style.display = "block";
      } else {
        document.getElementById("incident-report-form").style.display = "none";
        // Hide countdown timer when form is hidden
        const countdownTimer = document.getElementById("countdown-timer");
        if (countdownTimer) {
          countdownTimer.style.display = "none";
        }
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
      }

      pendingList.innerHTML = `
              <table>
                <thead>
                  <tr>
                    <th>Item ID</th>
                    <th>Status</th>
                    <th>Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  ${pendingReports
                    .map((report) => {
                      const deadline = report.deadlineAt
                        ? new Date(report.deadlineAt).toLocaleString()
                        : "N/A";
                      const statusClass =
                        report.status === "Pending Submission"
                          ? "status-Pending"
                          : report.status === "Submitted"
                            ? "status-Approved"
                            : report.status === "Pending Review"
                              ? "status-Pending"
                              : report.status === "Rejected"
                                ? "status-Rejected"
                                : "status-Returned";
                      return `
                      <tr>
                        <td style="word-wrap: break-word; overflow-wrap: break-word;">${
                          report.equipmentId || "N/A"
                        }</td>
                        <td><span class="status-badge ${statusClass}">${
                          report.status
                        }</span></td>
                        <td style="word-wrap: break-word; overflow-wrap: break-word;">${deadline}</td>
                      </tr>
                    `;
                    })
                    .join("")}
                </tbody>
              </table>
            `;
    } catch (error) {
      console.error("Error fetching pending reports:", error);
      const pendingList = document.getElementById("pending-reports-list");
      if (pendingList) {
        pendingList.innerHTML = `<p style="color: var(--text-subtle);">Error: ${
          error.message || "Failed to load pending reports."
        }</p>`;
      }
      showToast(
        `Failed to load pending reports: ${error.message || "Unknown error"}`,
        "error",
      );
    }
  };

  const startCountdown = (deadline) => {
    if (countdownInterval) clearInterval(countdownInterval);

    const countdownDisplay = document.getElementById("countdown-display");
    const countdownTimer = document.getElementById("countdown-timer");

    if (!countdownDisplay || !countdownTimer) {
      console.warn("Countdown timer elements not found");
      return;
    }

    const updateCountdown = () => {
      const now = new Date();
      const diff = deadline - now;

      if (diff <= 0) {
        countdownDisplay.textContent = "OVERDUE";
        countdownTimer.style.backgroundColor = "#fee2e2";
        countdownTimer.style.color = "#991b1b";
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      countdownDisplay.textContent = `${hours}h ${minutes}m ${seconds}s remaining`;

      // Reset timer styles if they were changed
      countdownTimer.style.backgroundColor = "#dbeafe";
      countdownTimer.style.color = "#1e40af";
    };

    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  };

  const checkSuspensionStatus = async () => {
    try {
      const response = await fetch("/api/check-suspension");
      if (!response.ok) return;
      const status = await response.json();

      if (status.isSuspended) {
        document.getElementById("suspension-banner").style.display = "block";
        document.getElementById("suspension-message").textContent =
          status.suspensionReason ||
          "You are suspended from borrowing equipment.";

        // Hide Equipment and My Requests links
        const equipmentLink = document.getElementById("nav-equipment");
        const requestsLink = document.getElementById("nav-my-requests");
        if (equipmentLink) equipmentLink.style.display = "none";
        if (requestsLink) requestsLink.style.display = "none";
      } else {
        document.getElementById("suspension-banner").style.display = "none";
        const equipmentLink = document.getElementById("nav-equipment");
        const requestsLink = document.getElementById("nav-my-requests");
        if (equipmentLink) equipmentLink.style.display = "flex";
        if (requestsLink) requestsLink.style.display = "flex";
      }
    } catch (error) {
      console.error("Error checking suspension status:", error);
    }
  };

  // Handle incident type change to show/hide other description
  document.getElementById("incidentType")?.addEventListener("change", (e) => {
    const otherGroup = document.getElementById("other-description-group");
    if (e.target.value === "Other") {
      otherGroup.style.display = "block";
      document.getElementById("otherDescription").required = true;
    } else {
      otherGroup.style.display = "none";
      document.getElementById("otherDescription").required = false;
    }
  });

  // Handle form submission
  document
    .getElementById("incident-report-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const incidentId = document.getElementById("report-incident-id").value;
      const equipmentId = document.getElementById("equipmentId").value;
      const dateOfIncident = document.getElementById("dateOfIncident").value;
      const incidentType = document.getElementById("incidentType").value;
      const detailedDescription = document.getElementById(
        "detailedDescription",
      ).value;
      const otherDescription =
        document.getElementById("otherDescription").value;
      const damageDescription =
        document.getElementById("damageDescription").value;
      const replacedItems = document.getElementById("replacedItems").value;
      const replacementAction =
        document.getElementById("replacementAction").value;

      if (incidentType === "Other" && !otherDescription) {
        showToast(
          'Please provide additional description for "Other" incident type.',
        );
        return;
      }

      try {
        const response = await fetch("/api/student-incident-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            incidentId,
            equipmentId,
            dateOfIncident,
            incidentType,
            detailedDescription,
            otherDescription:
              incidentType === "Other" ? otherDescription : undefined,
            damageDescription: damageDescription || undefined,
            replacedItems: replacedItems || undefined,
            replacementAction: replacementAction || undefined,
          }),
        });

        const result = await response.json();
        if (!response.ok)
          throw new Error(result.message || "Failed to submit report.");

        showToast("Incident report submitted successfully!", "success");

        // Clear countdown timer
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }

        // Reset form including hidden fields
        const form = document.getElementById("incident-report-form");
        form.reset();
        document.getElementById("report-incident-id").value = "";
        document.getElementById("report-id").value = "";

        // Hide other description group
        document.getElementById("other-description-group").style.display =
          "none";

        // Refresh data
        await fetchPendingReports();
        await fetchMyNotifications();
        updateNotificationBadge();
      } catch (error) {
        showToast(`Error: ${error.message}`);
        console.error("Error submitting incident report:", error);
      }
    });

  // --- 8. Reservation & Borrowing Info Functions ---
  let myReservations = [];

  const fetchBorrowingInfo = async (category = "") => {
    try {
      const query = category ? `?category=${encodeURIComponent(category)}` : "";
      const response = await fetch(`/api/borrowing-info${query}`);
      if (!response.ok) return;
      const info = await response.json();

      // Update reservations page banner
      const banner = document.getElementById("borrowing-info-banner");
      if (banner) {
        banner.style.display = "block";
        document.getElementById("reservations-borrow-limit").textContent =
          info.borrowingLimit || "--";
        document.getElementById("reservations-active-borrows").textContent =
          info.activeBorrows || 0;
        document.getElementById(
          "reservations-active-reservations",
        ).textContent = info.activeReservations || 0;
        document.getElementById("reservations-remaining").textContent =
          info.remainingSlots || 0;
        document.getElementById("replacement-return-days").textContent =
          info.replacementReturnDays || "--";
      }

      // Set min/max dates on reservation date inputs
      const pickupInput = document.getElementById("reservePickupDate");
      const returnInput = document.getElementById("reserveReturnDate");
      if (pickupInput && returnInput) {
        window.currentMaxBorrowDays = info.maxBorrowDays || 14;
        window.currentReservationMaxDays = info.reservationMaxDays || 7;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        const minPickupDate = tomorrow.toISOString().split("T")[0];

        const maxPickupDateObj = new Date(today);
        maxPickupDateObj.setDate(
          today.getDate() + window.currentReservationMaxDays,
        );
        const maxPickupDate = maxPickupDateObj.toISOString().split("T")[0];

        pickupInput.setAttribute("min", minPickupDate);
        pickupInput.setAttribute("max", maxPickupDate);

        returnInput.setAttribute("min", pickupInput.value || minPickupDate);
      }

      // Update modal borrowing info
      const modalInfo = document.getElementById("modal-borrowing-info");
      if (modalInfo) {
        modalInfo.style.display = "block";
        document.getElementById("modal-borrow-limit").textContent =
          info.borrowingLimit || "--";
        document.getElementById("modal-active-borrows").textContent =
          (info.activeBorrows || 0) + (info.activeReservations || 0);
        document.getElementById("modal-remaining-slots").textContent =
          info.remainingSlots || 0;
        document.getElementById("modal-max-days").textContent =
          info.maxBorrowDays || "--";
      }
    } catch (error) {
      console.error("Error fetching borrowing info:", error);
    }
  };

  // --- Go! ---
  initializeApp();
});
