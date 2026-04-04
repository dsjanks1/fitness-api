import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import type { Request, Response } from 'express'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // service role key - server only, never frontend
)

const CURRENT_USER_ID = 1 // MVP: single user

interface UserRow {
  id: number
  username: string
  height_cm: number | null
  age: number | null
  gender: string | null
  activity_level: string | null
  fitness_goals: string[]
  dietary_prefs: string[]
  injuries: string | null
}

interface WeightRow {
  weight_kg: number
  logged_at: string
}

interface GoalRow {
  target_weight: number
  start_weight: number
  start_date: string
  target_date: string | null
}

interface Stats {
  currentWeight: number | null
  totalLost: number | null
  weeklyAvg: number | null
  bmi: number | null
  goalProgress: number | null
}

function computeStats(weights: WeightRow[], goal: GoalRow | null, heightCm: number | null): Stats {
  if (!weights.length) {
    return { currentWeight: null, totalLost: null, weeklyAvg: null, bmi: null, goalProgress: null }
  }

  const sorted = [...weights].sort((a, b) => a.logged_at.localeCompare(b.logged_at))
  const currentWeight = sorted[sorted.length - 1].weight_kg
  const bmi = heightCm ? parseFloat((currentWeight / (heightCm / 100) ** 2).toFixed(1)) : null
  const totalLost = goal
    ? goal.start_weight - currentWeight
    : sorted[0].weight_kg - currentWeight

  const goalProgress = goal
    ? Math.min(100, Math.max(0,
        ((goal.start_weight - currentWeight) / (goal.start_weight - goal.target_weight)) * 100
      ))
    : null

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const recent = sorted.filter((w) => new Date(w.logged_at) >= thirtyDaysAgo)
  let weeklyAvg: number | null = null
  if (recent.length >= 2) {
    const days =
      (new Date(recent[recent.length - 1].logged_at).getTime() -
        new Date(recent[0].logged_at).getTime()) /
      (1000 * 60 * 60 * 24)
    const change = recent[recent.length - 1].weight_kg - recent[0].weight_kg
    weeklyAvg = parseFloat(((change / days) * 7).toFixed(2))
  }

  return { currentWeight, totalLost, weeklyAvg, bmi, goalProgress }
}

function buildSystemPrompt(
  user: UserRow,
  latestWeight: WeightRow | null,
  stats: Stats,
  goal: GoalRow | null
): string {
  const weightTrend =
    stats.weeklyAvg !== null
      ? `${stats.weeklyAvg < 0 ? 'Losing' : 'Gaining'} ${Math.abs(stats.weeklyAvg).toFixed(2)}kg/week on average`
      : 'Not enough data for trend'

  return `You are a personal AI fitness coach. You know everything about this user. Be direct, concise, and personalized. No generic advice.

## User Profile
- Name: ${user.username}
- Age: ${user.age ?? 'unknown'}, Gender: ${user.gender ?? 'unknown'}
- Height: ${user.height_cm ? `${user.height_cm}cm` : 'unknown'}
- Activity level: ${user.activity_level ?? 'unknown'}
- Fitness goals: ${(user.fitness_goals ?? []).join(', ')}
- Dietary preferences: ${(user.dietary_prefs ?? []).join(', ')}
- Injuries / limitations: ${user.injuries || 'None reported'}

## Current Stats
- Current weight: ${latestWeight ? `${latestWeight.weight_kg}kg` : 'Not logged yet'}
- BMI: ${stats.bmi ?? 'Unknown'}
- Total lost: ${stats.totalLost ? `${stats.totalLost.toFixed(1)}kg` : 'N/A'}
- Weekly trend: ${weightTrend}

## Active Goal
${
  goal
    ? `- Target: ${goal.target_weight}kg by ${goal.target_date ?? 'no deadline'}
- Started: ${goal.start_weight}kg on ${goal.start_date}
- Progress: ${stats.goalProgress?.toFixed(0) ?? 0}% complete
- Remaining: ${latestWeight ? (latestWeight.weight_kg - goal.target_weight).toFixed(1) : '?'}kg to go`
    : '- No active goal set'
}

## Your Instructions
1. Be specific to this user's data. Reference their actual numbers.
2. Respect their injuries ALWAYS. If they ask for a workout and have a wrist injury, avoid exercises that load the wrist. Flag substitutions explicitly.
3. Respect dietary preferences. ${(user.dietary_prefs ?? []).includes('no_fish') ? 'Never suggest fish.' : ''}
4. Keep responses concise for mobile. Use short paragraphs.
5. When generating a workout, use the exact [WORKOUT_CARD] format below.
6. When asked about progress, give honest assessments based on their data.
7. If they're plateauing (< 0.2kg/week for 3+ weeks), address it directly.
8. Tone: like a knowledgeable friend who trains, not a corporate wellness chatbot.

## Workout Card Format

When generating a workout, you MUST use this exact format so the app can render it visually.
Include the markers exactly as shown. Plain text before/after the card is fine.

[WORKOUT_CARD]
title: Upper Body - Push
type: Strength
duration_minutes: 45
injury_warning: Avoiding wrist extension load - all pressing done with neutral grip
exercises:
- name: Dumbbell Shoulder Press
  sets: 3
  reps: 10
  rest_seconds: 60
  injury_note: Use neutral grip dumbbells, not barbell
- name: Cable Fly
  sets: 3
  reps: 12
  rest_seconds: 60
- name: Tricep Pushdown (rope)
  sets: 3
  reps: 15
  rest_seconds: 45
[/WORKOUT_CARD]

Only use this format when the user explicitly asks for a workout or training plan.`
}

export async function chatHandler(req: Request, res: Response): Promise<void> {
  const { message, history } = req.body as {
    message: string
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  }

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message required' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const [userRes, weightRes, goalRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', CURRENT_USER_ID).single(),
      supabase
        .from('weight_entries')
        .select('weight_kg, logged_at')
        .eq('user_id', CURRENT_USER_ID)
        .order('logged_at', { ascending: false })
        .limit(30),
      supabase
        .from('goals')
        .select('*')
        .eq('user_id', CURRENT_USER_ID)
        .is('completed_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const user = userRes.data as UserRow | null
    const weights = (weightRes.data ?? []) as WeightRow[]
    const goal = goalRes.data as GoalRow | null

    if (!user) {
      res.write(`data: {"error":"User not found"}\n\n`)
      res.end()
      return
    }

    const stats = computeStats(weights, goal, user.height_cm)
    const systemPrompt = buildSystemPrompt(user, weights[0] ?? null, stats, goal)

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...(history ?? []).slice(-20),
      { role: 'user', content: message },
    ]

    let fullResponse = ''

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: systemPrompt,
      messages,
    })

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        const delta = chunk.delta.text
        fullResponse += delta
        res.write(`data: ${JSON.stringify({ delta })}\n\n`)
      }
    }

    res.write(`data: [DONE]\n\n`)
    res.end()

    // Save both messages (fire and forget)
    void supabase.from('chat_messages').insert([
      { user_id: CURRENT_USER_ID, role: 'user', content: message },
      { user_id: CURRENT_USER_ID, role: 'assistant', content: fullResponse },
    ])
  } catch (err) {
    console.error('Chat handler error:', err)
    res.write(`data: {"error":"Something went wrong"}\n\n`)
    res.end()
  }
}
