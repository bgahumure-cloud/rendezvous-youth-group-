const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Create upload directories
['./uploads', './uploads/profiles', './uploads/media'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('‚úÖ MongoDB Connected'))
    .catch(err => console.error('‚ùå MongoDB Error:', err.message));

// ==================== SCHEMAS ====================

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['director', 'admin', 'facilitator', 'member', 'volunteer'], default: 'member' },
    phone: { type: String, default: '' },
    bio: { type: String, default: '' },
    profilePicture: { type: String, default: '' },
    specialty: { type: String, default: '' },
    nationality: { type: String, default: '' },
    joinDate: { type: Date, default: Date.now },
    status: { type: String, default: 'active' }
}, { timestamps: true });

const ActivitySchema = new mongoose.Schema({
    title: { type: String, required: true },
    type: { type: String, enum: ['advocacy', 'training', 'mdd', 'film'], required: true },
    description: { type: String, default: '' },
    date: { type: Date, required: true },
    time: { type: String, default: '' },
    location: { type: String, required: true },
    facilitator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    participantCount: { type: Number, default: 0 },
    maxParticipants: { type: Number, default: 50 },
    objectives: [{ type: String }],
    status: { type: String, enum: ['upcoming', 'ongoing', 'completed'], default: 'upcoming' },
    feedback: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, rating: Number, comment: String }]
}, { timestamps: true });

const MediaSchema = new mongoose.Schema({
    title: { type: String, required: true },
    type: { type: String, enum: ['image', 'video', 'document'], required: true },
    url: { type: String, required: true },
    category: { type: String, default: 'general' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    views: { type: Number, default: 0 }
}, { timestamps: true });

const PartnerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, default: 'NGO' },
    status: { type: String, default: 'active' },
    contact: { type: String, default: '' },
    email: { type: String, default: '' }
}, { timestamps: true });

const TransactionSchema = new mongoose.Schema({
    description: { type: String, required: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Activity = mongoose.model('Activity', ActivitySchema);
const Media = mongoose.model('Media', MediaSchema);
const Partner = mongoose.model('Partner', PartnerSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

// ==================== MIDDLEWARE ====================

const verifyToken = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ error: 'Access denied' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

const authorize = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    next();
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = file.fieldname === 'profilePicture' ? 'uploads/profiles/' : 'uploads/media/';
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, role, phone, bio, nationality, specialty } = req.body;
        if (await User.findOne({ email })) return res.status(400).json({ error: 'Email already registered' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ name, email, password: hashedPassword, role: role || 'member', phone, bio, nationality, specialty });
        await user.save();
        const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ message: 'Registration successful', token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ message: 'Login successful', token, user: { id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone, bio: user.bio, profilePicture: user.profilePicture, specialty: user.specialty } });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/auth/me', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/auth/profile', verifyToken, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.user.id, req.body, { new: true }).select('-password');
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Update failed' });
    }
});

app.post('/api/auth/upload-profile', verifyToken, upload.single('profilePicture'), async (req, res) => {
    try {
        const url = `/uploads/profiles/${req.file.filename}`;
        await User.findByIdAndUpdate(req.user.id, { profilePicture: url });
        res.json({ message: 'Profile picture updated', url });
    } catch (error) {
        res.status(500).json({ error: 'Upload failed' });
    }
});

app.put('/api/auth/change-password', verifyToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user.id);
        if (!(await bcrypt.compare(currentPassword, user.password))) return res.status(401).json({ error: 'Current password incorrect' });
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ message: 'Password changed' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MEMBER ROUTES ====================

app.get('/api/members', verifyToken, authorize('director', 'admin'), async (req, res) => {
    try {
        const members = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(members);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/members', verifyToken, authorize('director', 'admin'), async (req, res) => {
    try {
        const { name, email, password, role, phone, bio } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const member = new User({ name, email, password: hashedPassword, role, phone, bio });
        await member.save();
        res.status(201).json({ message: 'Member created', member });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/members/:id', verifyToken, authorize('director', 'admin'), async (req, res) => {
    try {
        const member = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select('-password');
        res.json(member);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/members/:id', verifyToken, authorize('director'), async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ message: 'Member deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ACTIVITY ROUTES ====================

app.get('/api/activities', verifyToken, async (req, res) => {
    try {
        const activities = await Activity.find().populate('facilitator', 'name email').sort({ date: -1 });
        res.json(activities);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/activities', verifyToken, authorize('facilitator', 'admin', 'director'), async (req, res) => {
    try {
        const activity = new Activity({ ...req.body, facilitator: req.user.id });
        await activity.save();
        const populated = await Activity.findById(activity._id).populate('facilitator', 'name');
        res.status(201).json(populated);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/activities/:id', verifyToken, authorize('facilitator', 'admin', 'director'), async (req, res) => {
    try {
        const activity = await Activity.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(activity);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/activities/:id/register', verifyToken, async (req, res) => {
    try {
        const activity = await Activity.findById(req.params.id);
        if (activity.participants.includes(req.user.id)) return res.status(400).json({ error: 'Already registered' });
        activity.participants.push(req.user.id);
        activity.participantCount = activity.participants.length;
        await activity.save();
        res.json({ message: 'Registered successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/activities/:id/cancel-registration', verifyToken, async (req, res) => {
    try {
        const activity = await Activity.findById(req.params.id);
        const index = activity.participants.indexOf(req.user.id);
        if (index !== -1) activity.participants.splice(index, 1);
        activity.participantCount = activity.participants.length;
        await activity.save();
        res.json({ message: 'Cancelled successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== MEDIA ROUTES ====================

app.get('/api/media', verifyToken, async (req, res) => {
    try {
        const media = await Media.find().populate('uploadedBy', 'name').sort({ createdAt: -1 });
        res.json(media);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/media', verifyToken, upload.single('file'), async (req, res) => {
    try {
        const { title, type, category } = req.body;
        const media = new Media({ title, type, url: `/uploads/media/${req.file.filename}`, category, uploadedBy: req.user.id });
        await media.save();
        res.status(201).json(media);
    } catch (error) {
        res.status(500).json({ error: 'Upload failed' });
    }
});

// ==================== PARTNER ROUTES ====================

app.get('/api/partners', verifyToken, async (req, res) => {
    try {
        const partners = await Partner.find().sort({ name: 1 });
        res.json(partners);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/partners', verifyToken, authorize('director', 'admin'), async (req, res) => {
    try {
        const partner = new Partner(req.body);
        await partner.save();
        res.status(201).json(partner);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== FINANCE ROUTES ====================

app.get('/api/transactions', verifyToken, authorize('director', 'admin'), async (req, res) => {
    try {
        const transactions = await Transaction.find().populate('recordedBy', 'name').sort({ date: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/transactions', verifyToken, authorize('director', 'admin'), async (req, res) => {
    try {
        const transaction = new Transaction({ ...req.body, recordedBy: req.user.id });
        await transaction.save();
        res.status(201).json(transaction);
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/finance/summary', verifyToken, authorize('director', 'admin'), async (req, res) => {
    try {
        const transactions = await Transaction.find();
        const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        res.json({ totalIncome, totalExpenses, netBalance: totalIncome - totalExpenses });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== DASHBOARD STATS ====================

app.get('/api/dashboard/stats', verifyToken, async (req, res) => {
    try {
        const totalMembers = await User.countDocuments();
        const totalActivities = await Activity.countDocuments();
        const totalMedia = await Media.countDocuments();
        const totalPartners = await Partner.countDocuments();
        const recentActivities = await Activity.find().sort({ date: -1 }).limit(5).populate('facilitator', 'name');
        res.json({ stats: { totalMembers, totalActivities, totalMedia, totalPartners }, recentActivities });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ORGANIZATION INFO ====================

app.get('/api/organization/info', (req, res) => {
    res.json({
        name: "Rendezvous Youth Group",
        mission: "To create opportunities for youth to be self-reliant through skills, training, and talent development",
        description: "Rendezvous Youth Group is a refugee-led organization based in Kampala ‚Äì Uganda. It is composed of forced migrants from different nations of East-central Africa who have the vision to empower young people to be responsible and self-reliant.",
        contact: { email: "info@rendezvousyg.org", phone: "+256-700-123456", address: "Kampala, Uganda" }
    });
});

// ==================== SERVE STATIC FILES ====================

app.use(express.static(__dirname));

// ==================== START SERVER ====================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`\nÌ∫Ä Server running on http://localhost:${PORT}`);
    console.log(`Ì≥ù API: http://localhost:${PORT}/api`);
    console.log(`‚úÖ Ready to use!\n`);
});
