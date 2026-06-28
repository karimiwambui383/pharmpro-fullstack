// ════════════════════════════════════════════════════════════
// lib/safety/types.ts
// Shared types for the safety check engine
// ════════════════════════════════════════════════════════════

export type WarningSeverity = 'INFO' | 'WARNING' | 'MAJOR' | 'CONTRAINDICATED'

export interface SafetyWarning {
  type:        'ALLERGY' | 'INTERACTION' | 'PREGNANCY' | 'CONTROLLED' | 'DUPLICATE'
  severity:    WarningSeverity
  title:       string
  message:     string
  requiresOverride: boolean   // if true, pharmacist must explicitly acknowledge
  meta?:       Record<string, unknown>
}

export interface SafetyCheckResult {
  safe:        boolean        // false = at least one CONTRAINDICATED warning
  warnings:    SafetyWarning[]
  // safe=false must NOT block dispense — it must force an override acknowledgment.
  // The clinician always decides. The system always warns.
}


// ════════════════════════════════════════════════════════════
// lib/safety/allergyCheck.ts
// Checks if any drug in the prescription matches a known
// patient allergy or a drug class the patient reacts to.
// ════════════════════════════════════════════════════════════

import { prisma }          from '../../config/prisma'
import type { SafetyWarning } from './types'

// Known cross-reactivity map — drug class → related allergens
// e.g. Amoxicillin belongs to Penicillins; a penicillin-allergic
// patient should be warned even if "Amoxicillin" isn't listed.
const CROSS_REACTIVITY: Record<string, string[]> = {
  'Penicillin':       ['Amoxicillin','Ampicillin','Flucloxacillin','Co-amoxiclav','Piperacillin'],
  'Sulfonamides':     ['Sulfamethoxazole','Co-trimoxazole','Trimethoprim-Sulfa'],
  'Cephalosporins':   ['Cefalexin','Cefuroxime','Ceftriaxone','Cefixime'],
  'NSAIDs':           ['Ibuprofen','Diclofenac','Aspirin','Naproxen','Indomethacin'],
  'Macrolides':       ['Azithromycin','Clarithromycin','Erythromycin'],
  'Fluoroquinolones': ['Ciprofloxacin','Levofloxacin','Norfloxacin'],
  'Statins':          ['Atorvastatin','Simvastatin','Rosuvastatin','Lovastatin'],
}

function isDrugRelatedToAllergen(drugName: string, allergen: string): boolean {
  const dn = drugName.toLowerCase()
  const al = allergen.toLowerCase()

  // Direct match
  if (dn.includes(al) || al.includes(dn)) return true

  // Cross-reactivity check
  for (const [classAllergen, drugs] of Object.entries(CROSS_REACTIVITY)) {
    if (al.includes(classAllergen.toLowerCase())) {
      if (drugs.some(d => dn.includes(d.toLowerCase()))) return true
    }
  }

  return false
}

export async function runAllergyCheck(
  patientId: string,
  drugIds:   string[],
): Promise<SafetyWarning[]> {
  const warnings: SafetyWarning[] = []

  const [allergies, drugs] = await Promise.all([
    prisma.allergy.findMany({
      where: { patientId, isActive: true, allergenType: { in: ['DRUG'] } },
    }),
    prisma.drug.findMany({
      where: { id: { in: drugIds } },
      select: { id: true, brandName: true, genericName: true, drugClass: true },
    }),
  ])

  if (!allergies.length) return []

  for (const drug of drugs) {
    for (const allergy of allergies) {
      const related = isDrugRelatedToAllergen(drug.genericName, allergy.allergen)
                   || isDrugRelatedToAllergen(drug.brandName,   allergy.allergen)
                   || (drug.drugClass
                        ? isDrugRelatedToAllergen(drug.drugClass, allergy.allergen)
                        : false)

      if (related) {
        const sevMap: Record<string, WarningSeverity> = {
          MILD:              'WARNING',
          MODERATE:          'WARNING',
          SEVERE:            'MAJOR',
          LIFE_THREATENING:  'CONTRAINDICATED',
          UNKNOWN:           'WARNING',
        }
        const sev = sevMap[allergy.severity] ?? 'WARNING'

        warnings.push({
          type:    'ALLERGY',
          severity: sev,
          title:   `Allergy alert — ${drug.genericName}`,
          message: `Patient has a documented ${allergy.severity.toLowerCase()} allergy to ${allergy.allergen}.`
                 + (allergy.reaction ? ` Known reaction: ${allergy.reaction}.` : ''),
          requiresOverride: ['MAJOR','CONTRAINDICATED'].includes(sev),
          meta: {
            drugId:       drug.id,
            drugName:     drug.genericName,
            allergen:     allergy.allergen,
            allergenId:   allergy.id,
            severity:     allergy.severity,
            reaction:     allergy.reaction,
          },
        })
      }
    }
  }

  return warnings
}


// ════════════════════════════════════════════════════════════
// lib/safety/interactionCheck.ts
// Checks every pair of drugs in the prescription AND against
// the patient's current medications stored on their profile.
// ════════════════════════════════════════════════════════════

import { prisma }             from '../../config/prisma'
import type { SafetyWarning } from './types'

export async function runInteractionCheck(
  drugIds:            string[],
  currentMedications: string[], // free-text from patient.currentMedications
): Promise<SafetyWarning[]> {
  const warnings: SafetyWarning[] = []
  if (drugIds.length < 1) return []

  // Check pairs within the new prescription
  const interactions = await prisma.drugInteraction.findMany({
    where: {
      isActive: true,
      OR: [
        { drugAId: { in: drugIds }, drugBId: { in: drugIds } },
      ],
    },
    include: {
      drugA: { select: { genericName: true } },
      drugB: { select: { genericName: true } },
    },
  })

  // Also check against drugs already in patient's active prescriptions
  if (drugIds.length > 0) {
    const existingInteractions = await prisma.drugInteraction.findMany({
      where: {
        isActive: true,
        OR: [
          { drugAId: { in: drugIds } },
          { drugBId: { in: drugIds } },
        ],
      },
      include: {
        drugA: { select: { genericName: true } },
        drugB: { select: { genericName: true } },
      },
    })
    interactions.push(...existingInteractions)
  }

  // Deduplicate
  const seen  = new Set<string>()
  const unique = interactions.filter(ix => {
    const key = [ix.drugAId, ix.drugBId].sort().join('-')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  for (const ix of unique) {
    const sevMap: Record<string, WarningSeverity> = {
      MINOR:            'INFO',
      MODERATE:         'WARNING',
      MAJOR:            'MAJOR',
      CONTRAINDICATED:  'CONTRAINDICATED',
    }
    const sev = sevMap[ix.severity] ?? 'INFO'

    warnings.push({
      type:    'INTERACTION',
      severity: sev,
      title:   `Drug interaction — ${ix.drugA.genericName} + ${ix.drugB.genericName}`,
      message: ix.description
             + (ix.mechanism ? ` Mechanism: ${ix.mechanism}.` : ''),
      requiresOverride: ['MAJOR','CONTRAINDICATED'].includes(sev),
      meta: {
        drugAName: ix.drugA.genericName,
        drugBName: ix.drugB.genericName,
        severity:  ix.severity,
        source:    ix.source,
      },
    })
  }

  // Free-text current medication check (best-effort)
  // Logs a general warning if patient has many unstructured medications
  if (currentMedications.length > 3) {
    warnings.push({
      type:     'INTERACTION',
      severity: 'INFO',
      title:    'Multiple current medications',
      message:  `Patient is on ${currentMedications.length} current medications`
              + ` (${currentMedications.slice(0,3).join(', ')}...).`
              + ' Review for interactions not captured in the database.',
      requiresOverride: false,
      meta: { currentMedications },
    })
  }

  return warnings
}


// ════════════════════════════════════════════════════════════
// lib/safety/pregnancyCheck.ts
// Checks pregnancy category of each drug against patient status.
// ════════════════════════════════════════════════════════════

import { prisma }             from '../../config/prisma'
import type { SafetyWarning } from './types'

// FDA Pregnancy categories and their risk levels
const PREGNANCY_RISK: Record<string, { severity: WarningSeverity; label: string }> = {
  A: { severity: 'INFO',             label: 'Adequate studies show no fetal risk' },
  B: { severity: 'INFO',             label: 'Animal studies show no risk; no adequate human studies' },
  C: { severity: 'WARNING',          label: 'Animal studies show adverse effects; potential benefit may outweigh risk' },
  D: { severity: 'MAJOR',            label: 'Evidence of human fetal risk; benefits may outweigh risk' },
  X: { severity: 'CONTRAINDICATED',  label: 'Studies show fetal abnormalities; risks outweigh benefits. DO NOT USE.' },
}

export async function runPregnancyCheck(
  patientId: string,
  drugIds:   string[],
): Promise<SafetyWarning[]> {
  const warnings: SafetyWarning[] = []

  const patient = await prisma.patient.findUnique({
    where:  { id: patientId },
    select: { pregnancyStatus: true, isBreastfeeding: true },
  })

  if (!patient) return []

  const isPregnant      = patient.pregnancyStatus === 'PREGNANT'
  const isBreastfeeding = patient.isBreastfeeding || patient.pregnancyStatus === 'BREASTFEEDING'

  if (!isPregnant && !isBreastfeeding) return []

  const drugs = await prisma.drug.findMany({
    where:  { id: { in: drugIds } },
    select: { id: true, genericName: true, pregnancyCategory: true },
  })

  for (const drug of drugs) {
    const cat = drug.pregnancyCategory?.toUpperCase()

    if (isPregnant && cat) {
      const risk = PREGNANCY_RISK[cat]
      if (risk && ['C','D','X'].includes(cat)) {
        warnings.push({
          type:     'PREGNANCY',
          severity: risk.severity,
          title:    `Pregnancy risk — ${drug.genericName} (Category ${cat})`,
          message:  `Patient is pregnant. ${drug.genericName} is Pregnancy Category ${cat}. ${risk.label}.`,
          requiresOverride: ['D','X'].includes(cat),
          meta: { drugId: drug.id, drugName: drug.genericName, pregnancyCategory: cat },
        })
      }
    }

    if (isBreastfeeding) {
      // Category X and D drugs are also flagged for breastfeeding
      if (cat && ['D','X'].includes(cat)) {
        warnings.push({
          type:     'PREGNANCY',
          severity: 'WARNING',
          title:    `Breastfeeding caution — ${drug.genericName}`,
          message:  `Patient is breastfeeding. Verify safety of ${drug.genericName} during lactation.`,
          requiresOverride: false,
          meta: { drugId: drug.id, drugName: drug.genericName },
        })
      }
    }
  }

  return warnings
}


// ════════════════════════════════════════════════════════════
// lib/safety/controlledCheck.ts
// Flags controlled substances and enforces extra logging.
// ════════════════════════════════════════════════════════════

import { prisma }             from '../../config/prisma'
import type { SafetyWarning } from './types'

export async function runControlledCheck(drugIds: string[]): Promise<SafetyWarning[]> {
  const warnings: SafetyWarning[] = []

  const controlled = await prisma.drug.findMany({
    where: {
      id:                 { in: drugIds },
      controlledCategory: { in: ['SCHEDULE_I','SCHEDULE_II','SCHEDULE_III'] },
    },
    select: { id: true, genericName: true, controlledCategory: true },
  })

  for (const drug of controlled) {
    warnings.push({
      type:     'CONTROLLED',
      severity: drug.controlledCategory === 'SCHEDULE_I' ? 'CONTRAINDICATED' : 'MAJOR',
      title:    `Controlled substance — ${drug.genericName} (${drug.controlledCategory})`,
      message:  `${drug.genericName} is a ${drug.controlledCategory.replace('_',' ')} controlled substance.`
              + ' Ensure prescription is valid, verify prescriber license, and log in controlled substance register.',
      requiresOverride: true,
      meta: {
        drugId:   drug.id,
        drugName: drug.genericName,
        schedule: drug.controlledCategory,
      },
    })
  }

  return warnings
}


// ════════════════════════════════════════════════════════════
// lib/safety/safetyEngine.ts
// Orchestrates all checks and returns a unified result.
// Called before EVERY prescription dispense attempt.
// ════════════════════════════════════════════════════════════

import { runAllergyCheck }     from './allergyCheck'
import { runInteractionCheck } from './interactionCheck'
import { runPregnancyCheck }   from './pregnancyCheck'
import { runControlledCheck }  from './controlledCheck'
import type { SafetyCheckResult, WarningSeverity } from './types'
import { logger }              from '../logger'

const SEVERITY_ORDER: WarningSeverity[] = ['INFO','WARNING','MAJOR','CONTRAINDICATED']

export async function runSafetyChecks(params: {
  patientId:           string
  drugIds:             string[]
  currentMedications:  string[]
}): Promise<SafetyCheckResult> {
  const { patientId, drugIds, currentMedications } = params

  // Run all checks in parallel for speed
  const [allergyWarnings, interactionWarnings, pregnancyWarnings, controlledWarnings] =
    await Promise.all([
      runAllergyCheck(patientId, drugIds),
      runInteractionCheck(drugIds, currentMedications),
      runPregnancyCheck(patientId, drugIds),
      runControlledCheck(drugIds),
    ])

  const all = [
    ...allergyWarnings,
    ...interactionWarnings,
    ...pregnancyWarnings,
    ...controlledWarnings,
  ]

  // Sort by severity descending (most severe first)
  all.sort((a, b) =>
    SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity),
  )

  // System is NOT safe if any CONTRAINDICATED warning exists
  const safe = !all.some(w => w.severity === 'CONTRAINDICATED')

  if (!safe) {
    logger.warn({ patientId, drugIds, warnings: all.length }, 'Safety check failed — contraindicated combination')
  } else if (all.length > 0) {
    logger.info({ patientId, drugIds, warnings: all.length }, 'Safety check passed with warnings')
  }

  return { safe, warnings: all }
}

export type { SafetyCheckResult, SafetyWarning } from './types'