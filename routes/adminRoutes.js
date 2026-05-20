const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Models
const Youth = require("../models/Youth");
const Training = require("../models/Training");
const Advocacy = require("../models/Advocacy");
const MDD = require("../models/MDD");
const FilmScreening = require("../models/FilmScreening");
const Partner = require("../models/Partner");
const User = require("../models/User");
const SystemLog = require("../models/SystemLog");
const Budget = require("../models/Budget");
const SystemConfig = require("../models/SystemConfig");

// Middleware
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

// ==================== ADMIN DASHBOARD API ====================
router.get("/admin/dashboard", [auth, isAdmin], async (req, res) => {
  try {
    const totalYouth = await Youth.countDocuments();
    const activeYouth = await Youth.countDocuments({ status: "active" });
    const totalTrainings = await Training.countDocuments();
    const completedTrainings = await Training.countDocuments({ status: "completed" });
    const totalAdvocacy = await Advocacy.countDocuments();
    const totalMDD = await MDD.countDocuments();
    const totalScreenings = await FilmScreening.countDocuments();
    const totalPartners = await Partner.countDocuments();
    
    const budgets = await Budget.find();
    const totalBudget = budgets.reduce((sum, b) => sum + (b.allocated || 0), 0);
    const totalExpenses = budgets.reduce((sum, b) => sum + (b.spent || 0), 0);
    
    const mddRevenue = await MDD.aggregate([
      { $group: { _id: null, total: { $sum: "$revenueGenerated" } } }
    ]);
    
    const systemLogs = await SystemLog.find().sort({ createdAt: -1 }).limit(50);
    const errorLogs = systemLogs.filter(log => log.type === "error");
    const pendingApprovals = await Training.countDocuments({ status: "pending" });
    
    const recentActivities = await SystemLog.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("user", "name email");
    
    const alerts = {
      critical: [],
      warning: [],
      info: []
    };
    
    if (totalBudget - totalExpenses < totalBudget * 0.1) {
      alerts.critical.push("Budget running low - less than 10% remaining");
    }
    if (errorLogs.length > 10) {
      alerts.critical.push(`High error rate: ${errorLogs.length} errors in last 50 logs`);
    }
    
    const lowStockAlerts = await Youth.countDocuments({ needsSupport: true });
    if (lowStockAlerts > 20) {
      alerts.warning.push(`${lowStockAlerts} youth require immediate support`);
    }
    
    if (pendingTrainings > 5) {
      alerts.warning.push(`${pendingTrainings} trainings pending approval`);
    }
    
    const successRate = totalTrainings ? ((completedTrainings / totalTrainings) * 100).toFixed(1) : 0;
    
    res.json({
      admin: {
        name: req.user.name,
        role: "System Administrator",
        lastLogin: req.user.lastLogin
      },
      systemOverview: {
        totalYouth,
        activeYouth,
        totalTrainings,
        completedTrainings,
        successRate
      },
      programMetrics: {
        advocacy: totalAdvocacy,
        talentDevelopment: totalMDD,
        communityOutreach: totalScreenings,
        partnerships: totalPartners,
        volunteers: 0
      },
      financialOverview: {
        totalBudget,
        totalExpenses,
        remainingBudget: totalBudget - totalExpenses,
        budgetUtilization: totalBudget ? ((totalExpenses / totalBudget) * 100).toFixed(1) : 0,
        revenueGenerated: mddRevenue[0]?.total || 0
      },
      systemHealth: {
        status: errorLogs.length > 20 ? "degraded" : "healthy",
        errorRate: errorLogs.length,
        pendingApprovals,
        lastBackup: await getLastBackupDate()
      },
      recentActivities,
      alerts,
      performance: {
        userGrowthData: await getUserGrowthData()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== USER MANAGEMENT ====================
router.get("/admin/users", [auth, isAdmin], async (req, res) => {
  try {
    const { role, status, search } = req.query;
    let filter = {};
    
    if (role) filter.role = role;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }
    
    const users = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 });
    
    res.json({ users, total: users.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/admin/users", [auth, isAdmin], async (req, res) => {
  try {
    const { name, email, password, role, permissions } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      name,
      email,
      password: hashedPassword,
      role,
      permissions: permissions || getDefaultPermissions(role),
      createdBy: req.user._id,
      status: "active"
    });
    
    await user.save();
    
    await createSystemLog(req.user._id, "user_created", `Created user: ${email}`, req.ip);
    
    const userResponse = user.toObject();
    delete userResponse.password;
    
    res.json({ message: "User created successfully", user: userResponse });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/admin/users/:id", [auth, isAdmin], async (req, res) => {
  try {
    const { name, role, permissions, status } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, role, permissions, status },
      { new: true }
    ).select("-password");
    
    await createSystemLog(req.user._id, "user_updated", `Updated user: ${user.email}`, req.ip);
    
    res.json({ message: "User updated", user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/admin/users/:id", [auth, isAdmin], async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    
    await createSystemLog(req.user._id, "user_deleted", `Deleted user: ${user.email}`, req.ip);
    
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FINANCIAL MANAGEMENT ====================
router.get("/admin/financial", [auth, isAdmin], async (req, res) => {
  try {
    const budgets = await Budget.find().sort({ date: -1 });
    const totalBudget = budgets.reduce((sum, b) => sum + b.allocated, 0);
    const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
    
    const transactions = await Transaction.find()
      .sort({ date: -1 })
      .limit(50);
    
    const expenseByCategory = await Transaction.aggregate([
      { $match: { type: "expense" } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } }
    ]);
    
    res.json({
      budgetData: {
        allocated: totalBudget,
        spent: totalSpent,
        remaining: totalBudget - totalSpent
      },
      expenseData: {
        labels: expenseByCategory.map(e => e._id),
        values: expenseByCategory.map(e => e.total)
      },
      transactions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SYSTEM CONFIGURATION ====================
router.get("/admin/config", [auth, isAdmin], async (req, res) => {
  try {
    let config = await SystemConfig.findOne();
    if (!config) {
      config = await SystemConfig.create(getDefaultConfig());
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/admin/config", [auth, isAdmin], async (req, res) => {
  try {
    const config = await SystemConfig.findOneAndUpdate(
      {},
      { ...req.body, updatedBy: req.user._id, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    
    await createSystemLog(req.user._id, "config_updated", "System configuration updated", req.ip);
    
    res.json({ message: "Configuration updated", config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== AUDIT LOGS ====================
router.get("/admin/audit-logs", [auth, isAdmin], async (req, res) => {
  try {
    const { startDate, endDate, action, userId } = req.query;
    let filter = {};
    
    if (startDate) filter.createdAt = { $gte: new Date(startDate) };
    if (endDate) filter.createdAt = { ...filter.createdAt, $lte: new Date(endDate) };
    if (action) filter.action = action;
    if (userId) filter.user = userId;
    
    const logs = await SystemLog.find(filter)
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .limit(500);
    
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BACKUP MANAGEMENT ====================
router.post("/admin/backup", [auth, isAdmin], async (req, res) => {
  try {
    const backup = await createSystemBackup(req.user._id);
    res.json({ message: "Backup created", backup });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/admin/backups", [auth, isAdmin], async (req, res) => {
  try {
    const backups = await getBackupList();
    res.json(backups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== HELPER FUNCTIONS ====================
async function createSystemLog(userId, action, details, ipAddress) {
  const log = new SystemLog({
    user: userId,
    action,
    details,
    ipAddress,
    createdAt: new Date()
  });
  await log.save();
}

async function getLastBackupDate() {
  const backups = await getBackupList();
  return backups.length > 0 ? backups[0].createdAt : null;
}

async function getUserGrowthData() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const month = date.toLocaleString('default', { month: 'short' });
    const count = await User.countDocuments({
      createdAt: {
        $gte: new Date(date.getFullYear(), date.getMonth(), 1),
        $lt: new Date(date.getFullYear(), date.getMonth() + 1, 1)
      }
    });
    months.push({ month, count });
  }
  return months;
}

function getDefaultPermissions(role) {
  const permissions = {
    admin: ["all"],
    director: ["view_all", "approve_budget", "manage_programs"],
    facilitator: ["view_youth", "manage_trainings", "record_attendance"],
    viewer: ["view_only"]
  };
  return permissions[role] || ["view_only"];
}

function getDefaultConfig() {
  return {
    orgName: "Rendezvous Youth Group",
    sessionTimeout: 30,
    twoFactorAuth: false,
    notificationEmail: "admin@rendezvous.org",
    backupEnabled: true,
    autoBackupFrequency: "daily"
  };
}

async function createSystemBackup(userId) {
  // Implementation for creating system backup
  const backup = {
    filename: `backup_${Date.now()}.zip`,
    createdAt: new Date(),
    size: 1024 * 1024 * 10, // 10MB
    createdBy: userId
  };
  return backup;
}

async function getBackupList() {
  return [];
}

module.exports = router;