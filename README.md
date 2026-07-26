# LabLinx — DLSU-D Lab Inventory & Borrowing System

![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)
![JavaScript](https://img.shields.io/badge/javascript-%23F7DF1E.svg?style=for-the-badge&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/css3-%231572B6.svg?style=for-the-badge&logo=css3&logoColor=white)
![Vercel](https://img.shields.io/badge/vercel-%23000000.svg?style=for-the-badge&logo=vercel&logoColor=white)

LabLinx is a Laboratory Inventory, Borrowing Management, and Accountability System designed for De La Salle University - Dasmariñas (DLSU-D). It features multi-tenant administration across 8 specialized lab categories, real-time WebSocket dashboard synchronization, automated email notifications via SendGrid, barcode-driven inventory processing, and a 48-hour incident accountability system.

---

## System Architecture

LabLinx is built as a monolithic Express application backed by MongoDB. It provides a dual runtime execution model supporting both containerized environments (with active WebSockets and background cron tasks) and serverless deployments (such as Vercel).

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

### Architectural Key Points

- **Real-Time Synchronization**: State modifications trigger WebSocket broadcasts (`{ type: 'refresh' }`) to instantly update client dashboards.
- **Database Fallback**: Connection attempts target remote MongoDB Atlas (`DATABASE_URL`) with automatic fallback to local MongoDB (`LOCAL_DATABASE_URL`).
- **Execution Lifecycles**: Supports persistent server execution as well as serverless wrapping via `api/index.js`.

---

## Database Governance & Categories

The system manages 8 independent inventory collections mapped to lab categories:

- **admin** (General / Office Supplies) -> `Inventory`
- **admin2** (Science & Sports) -> `ScienceInventory`, `SportsInventory`
- **admin3** (Facilities & Labs) -> `FurnitureInventory`, `ComputerInventory`, `FoodLabInventory`, `MusicInventory`
- **admin4** (Robotics) -> `RoboticsInventory`

---

## API Overview

### Authentication
- `POST /login` - Local user authentication with rate-limited brute-force protection.
- `POST /register` - Student self-registration (pending admin approval).
- `GET /auth/microsoft` - Microsoft OAuth SSO restricted to institutional email domains (`@dlsud.edu.ph`, `@hs.dlsud.edu.ph`).
- `POST /logout` - Session invalidation.

### Inventory & Transactions
- `GET /api/inventory[1-8]` - Fetch available inventory catalog.
- `POST /api/inventory[1-8]` - Batch create asset records.
- `PUT /api/inventory[1-8]/:itemId` - Update asset properties and stock counts.
- `DELETE /api/inventory[1-8]/:itemId` - Decommission asset records (soft delete).
- `POST /api/request-item` - Submit equipment borrow requests.
- `POST /api/borrow-by-barcode` - Process item borrowing via barcode scanner.
- `POST /api/return-by-barcode` - Process returns and log asset condition.

---

## Security Controls

1. **CSRF Protection**: Origin-matching header verification on POST, PUT, and DELETE operations.
2. **Rate Limiting**: Express rate limiting on authentication routes (25 attempts / 10 mins) and API routes (180 requests / min).
3. **Session Management**: Secure, HttpOnly, and SameSite session cookies backed by `connect-mongo`.
4. **Credential Safety**: Dynamic environment-driven seed configuration and runtime secret generation.

---

## Configuration & Environment Variables

Create a `.env` file at the root directory (see `.env.example`):

```ini
PORT=3000
NODE_ENV=development
SESSION_SECRET=your_session_secret_key

DATABASE_URL=mongodb+srv://<user>:<password>@cluster.mongodb.net/lablinx
DATABASE_NAME=lablinx
LOCAL_DATABASE_URL=mongodb://localhost:27017/lablinx

SENDGRID_API_KEY=SG.your_sendgrid_api_key
SENDGRID_FROM=no-reply@dlsud.edu.ph

ALLOWED_DOMAIN=@dlsud.edu.ph,@hs.dlsud.edu.ph
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

---

## Local Development

```bash
# Install dependencies
npm install

# Start application server
npm start
```

Application runs at `http://localhost:3000`.
