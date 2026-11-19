const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const router = express.Router();

/* Update basic profile + KYC personal info */
router.put('/update', auth, async (req, res) => {
  const { displayName, country, twoFA, kycStatus, firstName, lastName, dateOfBirth } = req.body;
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (displayName !== undefined) user.displayName = displayName;
  if (country !== undefined)     user.country = country;
  if (twoFA !== undefined)       user.twoFA = !!twoFA;
  if (kycStatus !== undefined)   user.kycStatus = kycStatus;

  // KYC personal info
  if (firstName !== undefined) user.firstName = firstName;
  if (lastName !== undefined)  user.lastName = lastName;
  if (dateOfBirth !== undefined) {
    if (!dateOfBirth) {
      user.dateOfBirth = null;
    } else {
      const dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) return res.status(400).json({ error: 'Invalid date of birth' });
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 18) return res.status(400).json({ error: 'You must be 18 or older' });
      if (age > 120) return res.status(400).json({ error: 'Invalid date of birth' });
      user.dateOfBirth = dob;
    }
  }

  await user.save();
  const safe = await User.findById(user._id).select('-password -twoFASecret -securityQuestions');
  res.json(safe);
});

/* Change password */
router.put('/password', auth, async (req, res) => {
  const { current, next } = req.body;
  if (!current || !next) return res.status(400).json({ error: 'Both passwords required' });
  if (next.length < 6) return res.status(400).json({ error: 'New password min 6 chars' });

  const user = await User.findById(req.user._id);
  const ok = await bcrypt.compare(current, user.password);
  if (!ok) return res.status(401).json({ error: 'Current password incorrect' });

  user.password = await bcrypt.hash(next, 10);
  await user.save();
  res.json({ ok: true });
});

/* ============================================================
   SECURITY QUESTIONS
   ============================================================ */

const ALLOWED_QUESTIONS = [
  'What was your childhood nickname?',
  'What is the name of your first pet?',
  'What was the name of your first school?',
  'What city were you born in?',
  "What is your mother's maiden name?",
  'What was your first car?',
  'What is the name of your best friend from childhood?',
  'What street did you grow up on?'
];

router.get('/security-questions/available', (req, res) => {
  res.json(ALLOWED_QUESTIONS);
});

/* Set or update security questions (requires password) */
router.post('/security-questions', auth, async (req, res) => {
  try {
    const { password, questions } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    if (!Array.isArray(questions) || questions.length !== 3)
      return res.status(400).json({ error: 'Exactly 3 questions required' });

    const user = await User.findById(req.user._id);
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Incorrect password' });

    // Validate each question
    for (const q of questions) {
      if (!q.question || !q.answer) return res.status(400).json({ error: 'Question and answer required' });
      if (!ALLOWED_QUESTIONS.includes(q.question)) return res.status(400).json({ error: 'Invalid question' });
      if (q.answer.trim().length < 2) return res.status(400).json({ error: 'Answer too short' });
    }

    // Check for duplicate questions
    const uniqueQs = new Set(questions.map(q => q.question));
    if (uniqueQs.size !== 3) return res.status(400).json({ error: 'Questions must be different' });

    user.securityQuestions = await Promise.all(questions.map(async q => ({
      question: q.question,
      answerHash: await bcrypt.hash(q.answer.trim().toLowerCase(), 10)
    })));
    user.securityQuestionsSetAt = new Date();
    await user.save();

    res.json({ ok: true, questionsSet: 3 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Get my security question setup status (not the answers) */
router.get('/security-questions', auth, async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({
    hasQuestions: (user.securityQuestions || []).length === 3,
    questions: (user.securityQuestions || []).map(q => q.question),
    setAt: user.securityQuestionsSetAt
  });
});

module.exports = router;