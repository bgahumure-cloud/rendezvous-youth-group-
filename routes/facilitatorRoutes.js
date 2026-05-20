const express = require("express");
const router = express.Router();

const Youth = require("../models/Youth");
const Training = require("../models/Training");
const MDD = require("../models/MDD");
const Attendance = require("../models/Attendance");
const Task = require("../models/Task");
const Report = require("../models/Report");

const auth = require("../middleware/auth");
const isFacilitator = require("../middleware/isFacilitator");

// ==================== FACILITATOR DASHBOARD ====================
router.get("/facilitator/dashboard", [auth, isFacilitator], async (req, res) => {
  try {
    const myYouth = await Youth.countDocuments({ facilitator: req.user._id });
    
    const today = new Date().toISOString().split('T')[0];
    const todayAttendance = await Attendance.find({
      facilitator: req.user._id,
      date: today
    });
    const presentToday = todayAttendance.filter(a => a.status === "present").length;
    const attendanceRate = myYouth ? ((presentToday / myYouth) * 100).toFixed(1) : 0;
    
    const pendingTasks = await Task.countDocuments({
      assignedTo: req.user._id,
      status: { $ne: "completed" }
    });
    
    const upcomingSessions = await Training.countDocuments({
      facilitator: req.user._id,
      startDate: { $gte: new Date() },
      status: "pending"
    });
    
    const tasks = await Task.find({
      assignedTo: req.user._id,
      status: { $ne: "completed" }
    }).sort({ dueDate: 1 }).limit(5);
    
    const todaySchedule = [];
    const todayTrainings = await Training.find({
      facilitator: req.user._id,
      startDate: {
        $gte: new Date(new Date().setHours(0, 0, 0)),
        $lte: new Date(new Date().setHours(23, 59, 59))
      }
    });
    
    todayTrainings.forEach(t => {
      todaySchedule.push({
        _id: t._id,
        time: new Date(t.startDate).toLocaleTimeString(),
        type: "Training",
        title: t.title,
        location: t.location
      });
    });
    
    const todayMDD = await MDD.find({
      facilitator: req.user._id,
      date: {
        $gte: new Date(new Date().setHours(0, 0, 0)),
        $lte: new Date(new Date().setHours(23, 59, 59))
      }
    });
    
    todayMDD.forEach(m => {
      todaySchedule.push({
        _id: m._id,
        time: new Date(m.date).toLocaleTimeString(),
        type: "MDD",
        title: m.name,
        location: m.location
      });
    });
    
    res.json({
      myYouth,
      attendance: {
        today: presentToday,
        rate: attendanceRate
      },
      pendingTasks: pendingTasks,
      upcomingSessions: upcomingSessions,
      tasks: tasks.map(t => ({
        _id: t._id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate
      })),
      todaySchedule: todaySchedule.sort((a, b) => a.time.localeCompare(b.time))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== YOUTH MANAGEMENT ====================
router.get("/facilitator/youth", [auth, isFacilitator], async (req, res) => {
  try {
    const youth = await Youth.find({ facilitator: req.user._id })
      .select("-__v")
      .sort({ name: 1 });
    
    res.json(youth);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/facilitator/youth/:id", [auth, isFacilitator], async (req, res) => {
  try {
    const youth = await Youth.findOne({
      _id: req.params.id,
      facilitator: req.user._id
    });
    
    if (!youth) {
      return res.status(404).json({ message: "Youth not found" });
    }
    
    const attendance = await Attendance.find({ youth: youth._id })
      .sort({ date: -1 })
      .limit(30);
    
    const trainings = await Training.find({ attendees: youth._id });
    
    const performances = await MDD.find({ performers: youth._id });
    
    res.json({ youth, attendance, trainings, performances });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/facilitator/youth/:id/progress", [auth, isFacilitator], async (req, res) => {
  try {
    const { notes, skills, progress } = req.body;
    
    const youth = await Youth.findOneAndUpdate(
      { _id: req.params.id, facilitator: req.user._id },
      {
        $push: { notes },
        $addToSet: { skills: { $each: skills } },
        progress: progress
      },
      { new: true }
    );
    
    res.json({ message: "Progress updated", youth });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ATTENDANCE MANAGEMENT ====================
router.post("/facilitator/attendance/bulk", [auth, isFacilitator], async (req, res) => {
  try {
    const attendanceRecords = req.body;
    const today = new Date().toISOString().split('T')[0];
    
    for (const record of attendanceRecords) {
      await Attendance.findOneAndUpdate(
        {
          youth: record.youthId,
          facilitator: req.user._id,
          date: today
        },
        {
          status: record.status,
          checkInTime: record.checkin,
          checkOutTime: record.checkout,
          notes: record.notes
        },
        { upsert: true, new: true }
      );
    }
    
    res.json({ message: "Attendance recorded successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/facilitator/attendance/history", [auth, isFacilitator], async (req, res) => {
  try {
    const youthIds = await Youth.find({ facilitator: req.user._id }).distinct('_id');
    
    const attendanceHistory = await Attendance.aggregate([
      { $match: { youth: { $in: youthIds } } },
      { $group: {
        _id: "$date",
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ["$status", "late"] }, 1, 0] } }
      }},
      { $sort: { _id: -1 } },
      { $limit: 30 }
    ]);
    
    const historyWithRate = attendanceHistory.map(h => ({
      date: h._id,
      total: h.total,
      present: h.present,
      absent: h.absent,
      late: h.late,
      rate: h.total ? ((h.present / h.total) * 100).toFixed(1) : 0
    }));
    
    res.json(historyWithRate);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TRAINING MANAGEMENT ====================
router.get("/facilitator/trainings", [auth, isFacilitator], async (req, res) => {
  try {
    const upcoming = await Training.find({
      facilitator: req.user._id,
      startDate: { $gte: new Date() },
      status: "pending"
    }).sort({ startDate: 1 });
    
    const active = await Training.find({
      facilitator: req.user._id,
      status: "ongoing"
    });
    
    const activeWithProgress = await Promise.all(active.map(async t => {
      const attendeesCount = t.attendees?.length || 0;
      const progress = t.capacity ? (attendeesCount / t.capacity) * 100 : 0;
      return {
        ...t.toObject(),
        progress: Math.min(progress, 100)
      };
    }));
    
    res.json({
      upcoming,
      active: activeWithProgress
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/facilitator/trainings/:id/attendance", [auth, isFacilitator], async (req, res) => {
  try {
    const { youthIds, attendance } = req.body;
    const training = await Training.findOne({
      _id: req.params.id,
      facilitator: req.user._id
    });
    
    if (!training) {
      return res.status(404).json({ message: "Training not found" });
    }
    
    for (let i = 0; i < youthIds.length; i++) {
      const attendanceRecord = new Attendance({
        youth: youthIds[i],
        training: training._id,
        facilitator: req.user._id,
        status: attendance[i],
        date: new Date(),
        type: "training"
      });
      await attendanceRecord.save();
    }
    
    res.json({ message: "Training attendance recorded" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== MDD MANAGEMENT ====================
router.get("/facilitator/mdd", [auth, isFacilitator], async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todaySessions = await MDD.find({
      facilitator: req.user._id,
      date: { $gte: today, $lt: tomorrow }
    }).sort({ date: 1 });
    
    const upcoming = await MDD.find({
      facilitator: req.user._id,
      date: { $gte: tomorrow },
      status: "planned"
    }).sort({ date: 1 }).limit(10);
    
    res.json({
      today: todaySessions,
      upcoming
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/facilitator/mdd/:id/healing", [auth, isFacilitator], async (req, res) => {
  try {
    const { youthId, healingProgress, testimonial } = req.body;
    
    const mdd = await MDD.findOne({
      _id: req.params.id,
      facilitator: req.user._id
    });
    
    if (!mdd) {
      return res.status(404).json({ message: "MDD session not found" });
    }
    
    mdd.healingImpact = mdd.healingImpact || [];
    mdd.healingImpact.push({
      youth: youthId,
      progress: healingProgress,
      testimonial,
      date: new Date()
    });
    
    await mdd.save();
    
    await Youth.findByIdAndUpdate(youthId, { participatedInHealing: true });
    
    res.json({ message: "Healing impact recorded" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TASK MANAGEMENT ====================
router.put("/facilitator/tasks/:id/complete", [auth, isFacilitator], async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, assignedTo: req.user._id },
      { status: "completed", completedAt: new Date() },
      { new: true }
    );
    
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    
    res.json({ message: "Task completed", task });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REPORTS ====================
router.get("/facilitator/reports", [auth, isFacilitator], async (req, res) => {
  try {
    const reports = await Report.find({
      facilitator: req.user._id
    }).sort({ createdAt: -1 }).limit(20);
    
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/facilitator/reports/generate", [auth, isFacilitator], async (req, res) => {
  try {
    const { type, period } = req.body;
    
    let data = {};
    
    if (type === "attendance") {
      const youthIds = await Youth.find({ facilitator: req.user._id }).distinct('_id');
      const attendance = await Attendance.find({
        youth: { $in: youthIds },
        date: { $gte: new Date(period) }
      });
      data = { totalRecords: attendance.length, attendance };
    } else if (type === "progress") {
      const youth = await Youth.find({ facilitator: req.user._id });
      data = { youth, count: youth.length };
    }
    
    const report = new Report({
      title: `${type.toUpperCase()} Report - ${period}`,
      type,
      period,
      data,
      facilitator: req.user._id,
      createdAt: new Date()
    });
    
    await report.save();
    
    res.json({ message: "Report generated", report });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;