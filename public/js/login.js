document.addEventListener("DOMContentLoaded", () => {
  const formContainer = document.querySelector(".form-container");
  const sections = formContainer.querySelectorAll(".form-section");
  const navLinks = document.querySelectorAll(".nav-bar .nav-link");

  const loginSection = document.getElementById("login-section");
  const registrationMenu = document.getElementById("registration-menu");
  const studentRegisterSection = document.getElementById(
    "student-register-section",
  );
  const facultyRegisterSection = document.getElementById(
    "faculty-register-section",
  );
  const forgotPasswordSection = document.getElementById(
    "forgot-password-section",
  );

  const showRegisterMenuLink = document.getElementById("show-register-menu");
  const showStudentRegisterButton = document.getElementById(
    "show-student-register",
  );
  const showFacultyRegisterButton = document.getElementById(
    "show-faculty-register",
  );

  const showLoginLink = document.getElementById("show-login");
  const showLoginFacultyLink = document.getElementById("show-login-faculty");
  const showForgotPasswordLink = document.getElementById(
    "show-forgot-password",
  );
  const showLoginFromForgotLink = document.getElementById(
    "show-login-from-forgot",
  );

  const loginForm = document.getElementById("loginForm");
  const studentRegisterForm = document.getElementById("registerForm");
  const facultyRegisterForm = document.getElementById("facultyRegisterForm");
  const contactForm = document.getElementById("contactForm");
  const forgotPasswordForm = document.getElementById("forgotPasswordForm");

  const modeToggle = document.getElementById("mode-toggle");
  const modeIcon = document.getElementById("mode-icon");
  const microsoftLoginBtn = document.getElementById("microsoftLoginBtn");

  const showToast = (message) => {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  };

  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get("error");
  if (error) {
    if (error === "ms_login_failed") {
      showToast(
        "Microsoft login failed. Your email is not registered in our system.",
      );
    } else if (error === "ms_login_pending") {
      showToast(
        "Microsoft login successful, but your account is still pending approval.",
      );
    } else if (error === "ms_sso_disabled") {
      showToast(
        "Microsoft SSO is disabled in demo mode. Please use the quick-login credentials below.",
      );
    }
    window.history.replaceState({}, document.title, "/login");
  }

  const switchSection = (targetId) => {
    sections.forEach((s) => s.classList.remove("active"));
    const target = document.getElementById(targetId);
    if (target) target.classList.add("active");
  };

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.getAttribute("data-section");
      switchSection(targetId);
      navLinks.forEach((n) => n.classList.remove("active"));
      link.classList.add("active");
      if (targetId === "auth-section") {
        loginSection.style.display = "block";
        registrationMenu.style.display = "none";
        forgotPasswordSection.style.display = "none";
      }
    });
  });

  const showRegistrationMenu = (e) => {
    if (e) e.preventDefault();
    loginSection.style.display = "none";
    forgotPasswordSection.style.display = "none";
    registrationMenu.style.display = "block";
    studentRegisterSection.style.display = "block";
    facultyRegisterSection.style.display = "none";
    showStudentRegisterButton.classList.add("active");
    showFacultyRegisterButton.classList.remove("active");
  };

  showRegisterMenuLink.addEventListener("click", showRegistrationMenu);

  const toggleRegisterForm = (type) => {
    showStudentRegisterButton.classList.toggle("active", type === "student");
    showFacultyRegisterButton.classList.toggle("active", type === "faculty");
    studentRegisterSection.style.display =
      type === "student" ? "block" : "none";
    facultyRegisterSection.style.display =
      type === "faculty" ? "block" : "none";
  };

  showStudentRegisterButton.addEventListener("click", () =>
    toggleRegisterForm("student"),
  );
  showFacultyRegisterButton.addEventListener("click", () =>
    toggleRegisterForm("faculty"),
  );

  const showLogin = (e) => {
    if (e) e.preventDefault();
    registrationMenu.style.display = "none";
    forgotPasswordSection.style.display = "none";
    loginSection.style.display = "block";
  };

  showLoginLink.addEventListener("click", showLogin);
  showLoginFacultyLink.addEventListener("click", showLogin);
  showLoginFromForgotLink.addEventListener("click", showLogin);

  showForgotPasswordLink.addEventListener("click", (e) => {
    e.preventDefault();
    loginSection.style.display = "none";
    registrationMenu.style.display = "none";
    forgotPasswordSection.style.display = "block";
  });

  function createPasswordToggle(toggleElement, inputElement) {
    if (!toggleElement || !inputElement) return;
    toggleElement.addEventListener("click", () => {
      const isPassword = inputElement.type === "password";
      inputElement.type = isPassword ? "text" : "password";
      toggleElement.src = isPassword
        ? "https://api.iconify.design/mdi:eye-off-outline.svg"
        : "https://api.iconify.design/mdi:eye-outline.svg";
    });
  }

  const loginPasswordInput = document.getElementById("loginPassword");
  const loginPasswordWrapper = document.querySelector(
    "#login-section .password-wrapper",
  );
  if (loginPasswordWrapper && loginPasswordInput) {
    const loginEyeIcon = document.createElement("img");
    loginEyeIcon.src = "https://api.iconify.design/mdi:eye-outline.svg";
    loginEyeIcon.className = "eye-icon";
    loginEyeIcon.alt = "Toggle password visibility";
    loginPasswordWrapper.appendChild(loginEyeIcon);
    createPasswordToggle(loginEyeIcon, loginPasswordInput);
  }

  // Dark mode toggle
  modeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    const isDark = document.body.classList.contains("dark-mode");
    modeIcon.src = isDark
      ? "https://api.iconify.design/mdi:white-balance-sunny.svg"
      : "https://api.iconify.design/mdi:moon-waning-crescent.svg";
    localStorage.setItem("darkMode", isDark);
  });

  const savedDarkMode = localStorage.getItem("darkMode");
  if (savedDarkMode === "true") {
    document.body.classList.add("dark-mode");
    modeIcon.src = "https://api.iconify.design/mdi:white-balance-sunny.svg";
  }

  const apiBaseUrl = window.location.origin;

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(loginForm);
    const data = Object.fromEntries(formData.entries());
    try {
      const response = await fetch(apiBaseUrl + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (response.ok) {
        window.location.href = response.url;
      } else {
        const errorText = await response.text();
        showToast(errorText || "Login failed.");
      }
    } catch (err) {
      showToast("An error occurred. Please try again.");
    }
  });

  studentRegisterForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (document.getElementById("gradeLevel").value === "") {
      showToast("Please select a Grade Level to continue.");
      return;
    }
    const emailInput = document.getElementById("email");
    const emailValue = emailInput.value.toLowerCase();
    if (
      !emailValue.endsWith("@dlsud.edu.ph") &&
      !emailValue.endsWith("@hs.dlsud.edu.ph")
    ) {
      showToast(
        "Invalid email. Please use your @dlsud.edu.ph or @hs.dlsud.edu.ph address.",
      );
      return;
    }
    const formData = new FormData(studentRegisterForm);
    const data = Object.fromEntries(formData.entries());
    if (data.studentID) {
      data.studentID = "20" + data.studentID;
    }
    data.role = "student";
    data.gradeLevel = document.getElementById("gradeLevel").value;
    try {
      const response = await fetch(apiBaseUrl + "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const responseText = await response.text();
      showToast(responseText);
      if (response.ok) {
        studentRegisterForm.reset();
        showLogin();
      }
    } catch (err) {
      showToast("An error occurred during registration.");
    }
  });

  facultyRegisterForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById("facultyEmail");
    const emailValue = emailInput.value.toLowerCase();
    if (
      !emailValue.endsWith("@dlsud.edu.ph") &&
      !emailValue.endsWith("@hs.dlsud.edu.ph")
    ) {
      showToast(
        "Invalid email. Please use your @dlsud.edu.ph or @hs.dlsud.edu.ph address.",
      );
      return;
    }
    const formData = new FormData(facultyRegisterForm);
    const data = Object.fromEntries(formData.entries());
    data.role = "faculty";
    data.gradeLevel = "N/A";
    try {
      const response = await fetch(apiBaseUrl + "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const responseText = await response.text();
      showToast(responseText);
      if (response.ok) {
        facultyRegisterForm.reset();
        showLogin();
      }
    } catch (err) {
      showToast("An error occurred during registration.");
    }
  });

  contactForm.addEventListener("submit", (e) => {
    e.preventDefault();
    showToast("Message sent! We'll get back to you soon.");
    contactForm.reset();
  });

  forgotPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showToast(
      "If an account with that email exists, a password reset link has been sent.",
    );
    forgotPasswordForm.reset();
    showLogin();
  });

  if (microsoftLoginBtn) {
    microsoftLoginBtn.addEventListener("click", () => {
      window.location.href = apiBaseUrl + "/auth/microsoft";
    });
  }

  // Handle Quick Login demo clicks
  const quickLoginButtons = document.querySelectorAll(".demo-quick-login");
  quickLoginButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const usernameInput = document.getElementById("loginUsername");
      const passwordInput = document.getElementById("loginPassword");
      if (usernameInput && passwordInput) {
        usernameInput.value = btn.getAttribute("data-username");
        passwordInput.value = btn.getAttribute("data-password");
        
        // Submit the form
        if (typeof loginForm.requestSubmit === "function") {
          loginForm.requestSubmit();
        } else {
          loginForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        }
      }
    });
  });

  // Reduce branding panel animation on slow connections
  if (navigator.connection) {
    var ect = navigator.connection.effectiveType;
    if (ect === "2g" || ect === "slow-2g") {
      var bp = document.querySelector(".branding-panel");
      if (bp) bp.style.animation = "none";
    }
  }
});
