# LabLinx — DLSU-D Lab Inventory & Borrowing System

![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)
![JavaScript](https://img.shields.io/badge/javascript-%23F7DF1E.svg?style=for-the-badge&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/css3-%231572B6.svg?style=for-the-badge&logo=css3&logoColor=white)
![Vercel](https://img.shields.io/badge/vercel-%23000000.svg?style=for-the-badge&logo=vercel&logoColor=white)

LabLinx is an enterprise-grade Laboratory Inventory, Borrowing Management, and Accountability Tracking System tailored for De La Salle University - Dasmariñas (DLSU-D). It features multi-tenant administration (spanning 8 specialized lab categories), real-time synchronized dashboards via WebSockets, automated overdue email alerts via SendGrid, barcode-driven inventory transaction processing, and a strict 48-hour incident accountability system.

---

## 🏛️ System Architecture & Design

LabLinx is structured as a monolithic Node.js Express application backed by a MongoDB cluster. It serves a responsive static client bundle and operates a dual runtime execution model: stateful containerized hosting (supporting persistent WebSockets and in-memory cron scheduling) and stateless serverless hosting (tailored for platforms like Vercel).

```
                      +---------------------------------------+
                      |            Client Browsers            |
                      |   (Static SPA-Hybrid Web Dashboard)   |
                      +-------------------+-------------------+
                                          |
                        HTTPS (REST APIs) | WebSocket (Refresh Events)
                                          v
+-----------------------------------------------------------------------------+
| Express Monolithic Application (Node.js)                                    |
|                                                                             |
|  +-------------------+  +---------------------+  +-----------------------+  |
|  |   Auth Engine     |  |   Core REST APIs    |  | WebSocket Server (ws) |  |
|  |  Local / MS OAuth |  | (Inventory & Loans) |  |   (Real-time Sync)    |  |
|  +---------+---------+  +----------+----------+  +-----------+-----------+  |
|            |                       |                         |              |
|            |                       v                         |              |
|            |            +----------+----------+              |              |
|            |            | Transaction Logic   |              |              |
|            |            |  (Barcodes, Loans)  |              |              |
|            |            +----------+----------+              |              |
|            v                       |                         |              |
|  +---------------------------------v-------------------------v-----------+  |
|  |                   Database Layer (Mongoose ODM)                       |  |
|  |      (8 Scoped Inventory Collections + System Logs & Sessions)        |  |
|  +---------------------------------+-------------------------------------+  |
+------------------------------------+----------------------------------------+
                                     |
                                     v
                  +----------------------------------+
                  |  MongoDB Cluster (Atlas/Local)   |
                  +----------------------------------+
```

### Key Architectural Patterns

- **Real-time Live Sync**: Write actions (creates, updates, state changes) trigger a broadcast to all active WebSocket clients (`ws` engine sending `{ type: 'refresh' }`). Client dashboards capture this payload to refresh views instantly.
- **Resilient Database Fallback**: The app boots by establishing a connection to MongoDB Atlas (`DATABASE_URL`). If the connection drops or is unavailable, the backend gracefully falls back to a local database instance (`LOCAL_DATABASE_URL`).
- **Stateless vs. Stateful Lifecycle**:
  - **Persistent Server (e.g., PM2, ECS)**: Boots a persistent WebSocket server and schedules background cron automation.
  - **Serverless Server (e.g., Vercel)**: Runs as an ephemeral function wrapper (`api/index.js`). Background crons and WebSockets are disabled to fit serverless execution limitations. Instead, Cron automation is routed through secure webhook endpoints.

---

## 🗄️ Database Schema & Governance

LabLinx uses MongoDB managed through **Mongoose ODM**. The database spans **8 independent inventory collections** mapped to distinct lab categories. Access control is locked down using a multi-admin governance system.

### Inventory Category Allocation & Administration

Administrative routes are scoped by user role. Specific `admin` accounts can only edit/approve requests within their mapped categories:

- **`admin`** (General / Office Supplies) $\rightarrow$ `Inventory` collection.
- **`admin2`** (Science & Sports) $\rightarrow$ `ScienceInventory`, `SportsInventory` collections. Also owns accountability review.
- **`admin3`** (Facilities & Labs) $\rightarrow$ `FurnitureInventory`, `ComputerInventory`, `FoodLabInventory`, `MusicInventory` collections.
- **`admin4`** (Robotics) $\rightarrow$ `RoboticsInventory` collection.

---

### Core Data Models

#### 1. User

Represents authenticated students, staff, or administrators.

```typescript
{
  username:         String  (Required, Unique)
  firstName:        String  (Required)
  lastName:         String  (Required)
  studentID:        String  (Required, Unique)  // Barcode identifier
  email:            String  (Required, Unique)
  gradeLevel:       String  (Required)
  password:         String  (Optional for MS OAuth register)
  role:             String  (Default: "student")
  status:           String  (Enum: ["Pending", "Approved"])
  isSuspended:      Boolean (Default: false)
  suspensionReason: String  (Optional)
  suspensionDate:   Date    (Optional)
}
```

#### 2. Inventory (Applies to all 8 specialized collections)

Represents cataloged physical resources.

```typescript
{
  itemId:           String  (Required, Unique)  // Barcode identifier
  name:             String  (Required)
  category:         String  (Required)
  quantity:         Number  (Required, Min: 0)  // Available count
  originalQuantity: Number  (Required, Min: 0)  // Total stock
  location:         String  (Required)
  price:            Number  (Default: 0)
  status:           String  (Enum: ["Available", "In-Use", "Maintenance", "Damaged", "Calibration", "Decommissioned"])
}
```

#### 3. ItemRequest

Tracks request state, borrowing duration, and return status.

```typescript
{
  itemId:          String   (Required)
  itemName:        String   (Required)
  studentId:       ObjectId (Ref: "User", Required)
  studentName:     String   (Required)
  studentID:       String   (Required)
  quantity:        Number   (Required, Min: 1)
  startDate:       Date     (Required)
  dueDate:         Date     (Required)
  reason:          String   (Required)
  requestDate:     Date     (Default: Date.now)
  status:          String   (Enum: ["Pending", "Approved", "Rejected", "Returned"])
  category:        String   (Required)
  isDeleted:       Boolean  (Default: false)
  returnCondition: String   (Enum: ["Good", "Damaged", "Lost"], Default: "Good")
  damageNotes:     String   (Optional)
}
```

#### 4. StudentIncidentReport

Tracks physical damages. Suspends students automatically if they fail to report details within 48 hours.

```typescript
{
  incidentId:            ObjectId (Ref: "Incident", Required)
  studentId:             ObjectId (Ref: "User", Required)
  equipmentId:           String   (Required)
  dateOfIncident:        Date     (Required)
  incidentType:          String   (Enum: ["Damage to Equipment/Facility", "Lost or Missing Item", ...], Required)
  detailedDescription:   String   (Default: "Pending student submission")
  status:                String   (Enum: ["Pending Submission", "Submitted", "Pending Review", "Resolved", "Overdue"])
  deadlineAt:            Date     (Required - 48h from creation)
  replacedItems:         String   (Optional)
  damageDescription:     String   (Optional)
  replacementAction:     String   (Optional)
  returnDuration:        Number   (Optional)
  itemConditionOnReturn: String   (Enum: ["Good", "Damaged", "Lost", "Replaced", ""])
  replacementStatus:     String   (Enum: ["Not Required", "Pending", "In Progress", "Completed", ""])
  replacementDate:       Date     (Optional)
}
```

---

## 🔌 API Design

LabLinx exposes a RESTful interface protected by middleware-driven authentication layers.

### Authentication Endpoints

- `POST /login` - Local authentication. Employs a 15-minute brute-force lockout window after 8 consecutive failures.
- `POST /register` - Student self-registration (defaults user status to `Pending` admin approval).
- `GET /auth/microsoft` - Triggers MSAL Passport integration. Restricts email domains to Dela Salle University - Dasmariñas (`@dlsud.edu.ph`, `@hs.dlsud.edu.ph`).
- `POST /logout` - Invalidates server session and clears cookies.

### Inventory Management

Each of the 8 inventories inherits routes via a generic CRUD routing factory:

- `GET /api/inventory[1-8]` - Returns non-decommissioned assets. (Requires `isAuthenticated`)
- `POST /api/inventory[1-8]` - Batch-inserts new assets. Performs a race-condition-safe duplicate key validation checks prior to storage. (Requires `isAdmin`)
- `PUT /api/inventory[1-8]/:itemId` - Modifies properties. Altering total quantity or setting state to "Available" forces live availability recalculations against active borrowing records. (Requires `isAdmin`)
- `DELETE /api/inventory[1-8]/:itemId` - Safe soft-deletes assets. Transitions status to `Decommissioned` and sets availability to `0`. (Requires `isAdmin`)
- `GET /api/archived-inventory` - Lists all decommissioned items across collections. (Requires `isAdmin`)

### Borrowing & Barcode Operations

- `POST /api/request-item` - Student schedules a borrow request. Assures the borrowing quota limit has not been breached.
- `POST /api/borrow-by-barcode` - Admin issues items via barcode scanners. Scans Student ID and Item ID to update availability and create requests. (Requires `isAdmin`)
- `POST /api/return-by-barcode` - Process item returns via barcode. Logs return state (Good, Damaged, Lost) and spawns an Incident Report if damage is identified. (Requires `isAdmin`)
- `GET /api/borrowing-info` - Retrieves active quotas, active loans, and overdue counters for the student.

---

## 🔒 Security & Controls

1. **CSRF Mitigation**: Enforces origin-matching validation on state-changing methods (POST, PUT, DELETE) using custom headers (`Origin` / `Referer`) mapped to authorized domains.
2. **Brute Force Defenses**: Employs `express-rate-limit` configuration. Scans limit login routes to 25 attempts per 10 minutes and standard API requests to 180 requests per minute.
3. **Secure Sessions**: Configures HttpOnly, SameSite, and Secure (production-only) cookies backed by a MongoDB-persisted session store (`connect-mongo`).
4. **Race-Condition Safe Stock Controls**: Validates item availability by comparing transaction volumes against current stock levels before updating collection documents.

---

## 🌟 Portfolio Showcase & Demo Mode

To make this project easily reviewable by recruiters and developers, it is configured with a **graceful Showcase Mode** out of the box:

- **Soft Environment Checks**: If environment variables (like SendGrid or Microsoft SSO keys) are missing, the server logs a warning and boots using safe placeholders instead of crashing.
- **Local MongoDB Fallback**: The app connects automatically to your local MongoDB server (`mongodb://127.0.0.1:27017/lablinx`) if no remote URL is supplied.
- **Graceful Mock Fallbacks**:
  - Email triggers fall back to logging in the console instead of throwing errors.
  - Clicking Microsoft SSO when keys are not configured redirects back to `/login` with a friendly toast message.
- **Quick Demo Credentials**: The login screen displays quick-login badges to quickly auto-fill and log in with pre-seeded accounts:
  - **Admin (General)**: `admin` / `admin123`
  - **Faculty / Staff**: `faculty` / `faculty123`
  - **Student**: `student` / `student123`

---

## 🚀 Deployment & DevOps

### Required Environment Variables

Configure a `.env` file at the project root for local development:

```ini
# Server Setup
PORT=3000
NODE_ENV=development
SESSION_SECRET=your_super_secure_secret_key

# Databases
DATABASE_URL=mongodb+srv://<user>:<password>@cluster.mongodb.net/lablinx
DATABASE_NAME=lablinx
LOCAL_DATABASE_URL=mongodb://localhost:27017/lablinx

# Email Client
SENDGRID_API_KEY=SG.your_sendgrid_api_key
SENDGRID_FROM=lablinx-no-reply@dlsud.edu.ph

# Domain Limitations
ALLOWED_DOMAIN=@dlsud.edu.ph,@hs.dlsud.edu.ph
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Run MongoDB locally or check your Atlas credentials in .env

# 3. Start the application (local Node & WebSockets active)
npm start
```

_Your application will boot at http://localhost:3000 serving frontend assets from the `public/` directory._

### Serverless Deployment (Vercel)

The codebase includes a `vercel.json` manifest compiled to serve the monolithic Express app as a serverless function (`api/index.js` wrapper).

1. Connect your repository to **Vercel**.
2. Configure environment variables in Vercel project settings.
3. Vercel will map all incoming routes `/(.*)` to the serverless function.
4. **Note**: Real-time WebSockets and `node-cron` schedulers are inactive in this runtime mode. Set up **Vercel Cron Jobs** to trigger scheduled checks externally via API endpoints.
