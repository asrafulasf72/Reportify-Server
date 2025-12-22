

# ✅ SERVER SIDE – `Reportify`

```md
# 🏗️ Public Infrastructure Issue Reporting System (Server)

This repository contains the backend server for the Public Infrastructure Issue Reporting System. It provides secure REST APIs for authentication, issue management, staff assignment, payments, timelines, and role-based authorization.

---

## 🌐 Live Server URL
👉 https://your-live-server-url.com

---

## 🧠 Server Responsibilities

- Secure REST API development
- JWT authentication & authorization
- Role-based middleware protection
- Issue lifecycle & timeline management
- Staff assignment & workflow control
- Payment handling & invoice generation
- Server-side search, filter & pagination
- User blocking & premium logic enforcement

---

## 🔐 User Roles

### 👑 Admin
- View & manage all issues
- Assign staff (one-time assignment)
- Reject pending issues
- Manage citizens & staff
- View payments & statistics

### 🧑‍🔧 Staff
- View only assigned issues
- Update issue status (workflow restricted)
- Add progress updates

### 👤 Citizen
- Report issues
- Edit/Delete own pending issues
- Upvote issues
- Boost issue priority
- Subscribe to premium

---

## 📊 API Capabilities

- Issue CRUD operations
- Immutable timeline logging
- Prevent duplicate upvotes
- Enforce premium/free limits
- Boosted issue prioritization
- Secure Stripe payment handling
- PDF invoice support

---

## 🛠️ Technologies Used

### Backend Stack
- **Node.js**
- **Express.js v5**
- **MongoDB**
- **Firebase Admin SDK**
- **JWT**
- **Stripe**
- **dotenv**
- **CORS**

---

## 📂 Project Structure

```text
/api
 ├── auth
 ├── users
 ├── issues
 ├── staff
 ├── payments
 ├── timeline
 └── admin
