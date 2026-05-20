const express = require("express");
const router = express.Router();

const Youth = require("../models/Youth");
const Training = require("../models/Training");
const Advocacy = require("../models/Advocacy");
const MDD = require("../models/MDD");
const FilmScreening = require("../models/FilmScreening");
const Partner = require("../models/Partner");
const Budget = require("../models/Budget");
const Testimonial = require("../models/Testimonial");

const auth = require("../middleware/auth");
const isDirector = require("../middleware/isDirector");

// ==================== DIRECTOR OVERVIEW ====================
router.get("/director/overview", [auth, isDirector], async (req, res) => {
  try {
    const totalYouth = await Youth.countDocuments();
    const selfReliantYouth = await Youth.countDocuments({ selfReliant: true });
    const employedYouth = await Youth.countDocuments({ employed: true });
    
    const mddRevenue = await MDD.aggregate([
      { $group: { _id: null, total: { $sum: "$revenueGenerated" } } }
    ]);
    
    const screenings = await FilmScreening.find();
    const uniqueCommunities = [...new Set(screenings.map(s => s.community).filter(c => c))];
    const totalReached = screenings.reduce((sum, s) => sum + (s.actualAttendees || s.expectedAttendees || 0), 0);
    
    const achievements = [];
    if (selfReliantYouth > 50) achievements.push(`Over 50 youth achieved self-reliance`);
    if (mddRevenue[0]?.total > 10000000) achievements.push(`Generated over UGX 10M from talent development`);
    if (screenings.length > 20) achievements.push(`Reached over 20 communities through film screenings`);
    
    const upcomingPrograms = [];
    const upcomingTrainings = await Training.find({ startDate: { $gte: new Date() }, status: "pending" }).limit(3);
    upcomingTrainings.forEach(t => {
      upcomingPrograms.push({
        title: t.title,
        type: "Training",
        date: t.startDate.toLocaleDateString(),
        location: t.location,
        description: t.description,
        color: "#3498db"
      });
    });
    
    const upcomingMDD = await MDD.find({ date: { $gte: new Date() }, status: "planned" }).limit(2);
    upcomingMDD.forEach(m => {
      upcomingPrograms.push({
        title: m.name,
        type: "MDD",
        date: m.date.toLocaleDateString(),
        location: m.location,
        description: m.description,
        color: "#f39c12"
      });
    });
    
    const recentAdvocacy = await Advocacy.find().sort({ publishedAt: -1 }).limit(3);
    
    const partners = await Partner.find({ status: "active" }).limit(6);
    
    const impactTrendData = await getQuarterlyImpactData();
    
    res.json({
      youth: {
        total: totalYouth,
        selfReliant: selfReliantYouth,
        employed: employedYouth,
        selfRelianceRate: totalYouth ? ((selfReliantYouth / totalYouth) * 100).toFixed(1) : 0
      },
      impact: {
        selfRelianceRate: totalYouth ? ((selfReliantYouth / totalYouth) * 100).toFixed(1) : 0,
        trendData: impactTrendData
      },
      finance: {
        revenueGenerated: mddRevenue[0]?.total || 0
      },
      outreach: {
        communitiesServed: uniqueCommunities.length,
        totalReached: totalReached
      },
      achievements,
      upcomingPrograms,
      recentAdvocacy: recentAdvocacy.map(a => ({
        title: a.title,
        type: a.type,
        views: a.views,
        shares: a.shares
      })),
      partners: partners.map(p => ({
        name: p.name,
        contribution: p.contribution
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PROGRAM MANAGEMENT ====================
router.get("/director/programs", [auth, isDirector], async (req, res) => {
  try {
    const trainings = await Training.find();
    const completedTrainings = trainings.filter(t => t.status === "completed").length;
    
    const mddActivities = await MDD.find();
    const mddRevenue = mddActivities.reduce((sum, m) => sum + (m.revenueGenerated || 0), 0);
    const mddWithHealing = mddActivities.filter(m => m.healingFocus === true).length;
    
    const screenings = await FilmScreening.find();
    const totalAttendees = screenings.reduce((sum, s) => sum + (s.actualAttendees || s.expectedAttendees || 0), 0);
    const communitiesServed = [...new Set(screenings.map(s => s.community))].length;
    
    const activePrograms = [];
    
    const activeTrainings = await Training.find({ status: "ongoing" });
    activeTrainings.forEach(t => {
      const attendees = t.attendees?.length || 0;
      const progress = t.capacity ? (attendees / t.capacity) * 100 : 0;
      activePrograms.push({
        _id: t._id,
        name: t.title,
        type: "Training",
        status: t.status,
        progress: Math.min(progress, 100)
      });
    });
    
    const activeMDD = await MDD.find({ status: "ongoing" });
    activeMDD.forEach(m => {
      activePrograms.push({
        _id: m._id,
        name: m.name,
        type: "MDD",
        status: m.status,
        progress: 50
      });
    });
    
    res.json({
      trainings: {
        total: trainings.length,
        completed: completedTrainings,
        completionRate: trainings.length ? ((completedTrainings / trainings.length) * 100).toFixed(1) : 0
      },
      mdd: {
        total: mddActivities.length,
        withHealingFocus: mddWithHealing,
        revenue: mddRevenue
      },
      screenings: {
        total: screenings.length,
        totalAttendees,
        communitiesServed
      },
      activePrograms
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== IMPACT METRICS ====================
router.get("/director/impact", [auth, isDirector], async (req, res) => {
  try {
    const totalYouth = await Youth.countDocuments();
    const trainedYouth = await Youth.countDocuments({ trainingsAttended: { $exists: true, $not: { $size: 0 } } });
    const employedYouth = await Youth.countDocuments({ employed: true });
    const selfReliantYouth = await Youth.countDocuments({ selfReliant: true });
    
    const screenings = await FilmScreening.find();
    const totalScreenings = screenings.length;
    const communities = [...new Set(screenings.map(s => s.community))];
    const totalReached = screenings.reduce((sum, s) => sum + (s.actualAttendees || s.expectedAttendees || 0), 0);
    const actionsTaken = screenings.reduce((sum, s) => sum + (s.outcomes?.length || 0), 0);
    
    const successStories = await Testimonial.find({ type: "success-story", published: true })
      .populate("youth", "name photo")
      .limit(5);
    
    res.json({
      youthMetrics: {
        enrolled: totalYouth,
        trained: trainedYouth,
        employed: employedYouth,
        selfReliant: selfReliantYouth
      },
      communityMetrics: {
        screenings: totalScreenings,
        communities: communities.length,
        reached: totalReached,
        actions: actionsTaken
      },
      successStories: successStories.map(s => ({
        youthName: s.youth?.name,
        youthPhoto: s.youth?.photo,
        story: s.content,
        achievements: s.achievements
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REPORTS ====================
router.get("/director/reports", [auth, isDirector], async (req, res) => {
  try {
    const reports = await Report.find({ type: "director" }).sort({ createdAt: -1 }).limit(10);
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/director/reports/generate", [auth, isDirector], async (req, res) => {
  try {
    const { type, period } = req.body;
    const report = await generateReport(type, period, req.user._id);
    res.json({ message: "Report generated", report });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BUDGET OVERVIEW ====================
router.get("/director/budget", [auth, isDirector], async (req, res) => {
  try {
    const budgets = await Budget.find();
    const totalAllocated = budgets.reduce((sum, b) => sum + (b.allocated || 0), 0);
    const totalSpent = budgets.reduce((sum, b) => sum + (b.spent || 0), 0);
    const utilization = totalAllocated ? ((totalSpent / totalAllocated) * 100).toFixed(1) : 0;
    
    const categories = [
      { name: "Training Programs", allocated: 0, spent: 0 },
      { name: "MDD/Talent", allocated: 0, spent: 0 },
      { name: "Advocacy", allocated: 0, spent: 0 },
      { name: "Film Screenings", allocated: 0, spent: 0 },
      { name: "Administration", allocated: 0, spent: 0 }
    ];
    
    budgets.forEach(b => {
      const category = categories.find(c => c.name === b.category);
      if (category) {
        category.allocated += b.allocated;
        category.spent += b.spent;
      }
    });
    
    categories.forEach(c => {
      c.utilization = c.allocated ? ((c.spent / c.allocated) * 100).toFixed(1) : 0;
      c.remaining = c.allocated - c.spent;
    });
    
    res.json({
      allocated: totalAllocated,
      spent: totalSpent,
      remaining: totalAllocated - totalSpent,
      utilization,
      categories
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PARTNERS ====================
router.get("/director/partners", [auth, isDirector], async (req, res) => {
  try {
    const partners = await Partner.find().sort({ name: 1 });
    res.json({ partners });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== HELPER FUNCTIONS ====================
async function getQuarterlyImpactData() {
  const quarters = [];
  const now = new Date();
  
  for (let i = 3; i >= 0; i--) {
    const quarterStart = new Date(now.getFullYear(), now.getMonth() - (i * 3), 1);
    const quarterEnd = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
    
    const enrolled = await Youth.countDocuments({
      joinedDate: { $gte: quarterStart, $lte: quarterEnd }
    });
    
    const selfReliant = await Youth.countDocuments({
      selfReliant: true,
      joinedDate: { $lte: quarterEnd }
    });
    
    quarters.push({
      quarter: `Q${Math.floor(quarterStart.getMonth() / 3) + 1} ${quarterStart.getFullYear()}`,
      enrolled,
      selfReliant
    });
  }
  
  return quarters;
}

async function generateReport(type, period, userId) {
  const report = {
    title: `${type.toUpperCase()} Report - ${period}`,
    type,
    period,
    generatedBy: userId,
    date: new Date(),
    data: {}
  };
  
  const reportDoc = new Report(report);
  await reportDoc.save();
  
  return reportDoc;
}

module.exports = router;