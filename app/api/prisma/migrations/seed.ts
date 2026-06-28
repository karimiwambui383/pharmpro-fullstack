// prisma/seed.ts
// Run: npx prisma db seed
// Seeds: 1 branch, super-admin, demo staff, 20 drugs,
//        drug interactions, demo patients, demo inventory

import { PrismaClient, Role, ControlledCategory } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding PharmPro database...')

  // ── 1. Branch ─────────────────────────────────────────
  const branch = await prisma.branch.upsert({
    where:  { id: 'branch-eldoret-001' },
    update: {},
    create: {
      id:        'branch-eldoret-001',
      name:      'PharmaCare Eldoret',
      address:   'Uganda Road, Eldoret Town',
      county:    'Uasin Gishu',
      town:      'Eldoret',
      phone:     '+254 720 000 000',
      email:     'eldoret@pharmacare.co.ke',
      licenseNo: 'PPB/PH/2024/00847',
      kraPin:    'P051234567M',
    },
  })
  console.log('✅ Branch:', branch.name)

  // ── 2. Users ──────────────────────────────────────────
  const pw = (p: string) => bcrypt.hash(p, 12)

  const users = await Promise.all([
    prisma.user.upsert({
      where:  { email: 'admin@pharmacare.co.ke' },
      update: {},
      create: {
        firstName:    'System',
        lastName:     'Admin',
        email:        'admin@pharmacare.co.ke',
        passwordHash: await pw('Admin@1234!'),
        role:         Role.SUPER_ADMIN,
        branchId:     branch.id,
        phone:        '+254 700 000 001',
      },
    }),
    prisma.user.upsert({
      where:  { email: 'pharmacist@pharmacare.co.ke' },
      update: {},
      create: {
        firstName:    'Priya',
        lastName:     'Kato',
        email:        'pharmacist@pharmacare.co.ke',
        passwordHash: await pw('Pharma@1234!'),
        role:         Role.PHARMACIST,
        branchId:     branch.id,
        phone:        '+254 700 000 002',
      },
    }),
    prisma.user.upsert({
      where:  { email: 'cashier@pharmacare.co.ke' },
      update: {},
      create: {
        firstName:    'Ben',
        lastName:     'Mutua',
        email:        'cashier@pharmacare.co.ke',
        passwordHash: await pw('Cash@1234!'),
        role:         Role.CASHIER,
        branchId:     branch.id,
        phone:        '+254 700 000 003',
      },
    }),
    prisma.user.upsert({
      where:  { email: 'tech@pharmacare.co.ke' },
      update: {},
      create: {
        firstName:    'Amina',
        lastName:     'Musa',
        email:        'tech@pharmacare.co.ke',
        passwordHash: await pw('Tech@1234!'),
        role:         Role.TECHNICIAN,
        branchId:     branch.id,
        phone:        '+254 700 000 004',
      },
    }),
  ])
  console.log(`✅ Users: ${users.map(u => u.email).join(', ')}`)

  // ── 3. Drugs ──────────────────────────────────────────
  const drugData = [
    { brandName: 'Amoxil',         genericName: 'Amoxicillin',              drugClass: 'Antibiotic',        dosageForm: 'Capsule',  standardDose: '500mg q8h',   pregnancyCategory: 'B', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Glucophage',     genericName: 'Metformin',                drugClass: 'Antidiabetic',      dosageForm: 'Tablet',   standardDose: '500-850mg od', pregnancyCategory: 'B', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Panadol',        genericName: 'Paracetamol',              drugClass: 'Analgesic',         dosageForm: 'Tablet',   standardDose: '500-1000mg q6h', pregnancyCategory: 'B', controlledCategory: ControlledCategory.OTC },
    { brandName: 'Brufen',         genericName: 'Ibuprofen',                drugClass: 'NSAID',             dosageForm: 'Tablet',   standardDose: '400mg q8h',   pregnancyCategory: 'C', controlledCategory: ControlledCategory.OTC },
    { brandName: 'Lipitor',        genericName: 'Atorvastatin',             drugClass: 'Statin',            dosageForm: 'Tablet',   standardDose: '10-80mg od',  pregnancyCategory: 'X', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Ventolin',       genericName: 'Salbutamol',               drugClass: 'Bronchodilator',    dosageForm: 'Inhaler',  standardDose: '100-200mcg prn', pregnancyCategory: 'C', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Zithromax',      genericName: 'Azithromycin',             drugClass: 'Antibiotic',        dosageForm: 'Tablet',   standardDose: '500mg od 3d', pregnancyCategory: 'B', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Flagyl',         genericName: 'Metronidazole',            drugClass: 'Antiprotozoal',     dosageForm: 'Tablet',   standardDose: '400mg tds',   pregnancyCategory: 'B', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Coartem',        genericName: 'Artemether/Lumefantrine',  drugClass: 'Antimalarial',      dosageForm: 'Tablet',   standardDose: 'Weight-based', pregnancyCategory: 'C', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Cetzine',        genericName: 'Cetirizine',               drugClass: 'Antihistamine',     dosageForm: 'Tablet',   standardDose: '10mg od',     pregnancyCategory: 'B', controlledCategory: ControlledCategory.OTC },
    { brandName: 'Zantac',         genericName: 'Ranitidine',               drugClass: 'H2 blocker',        dosageForm: 'Tablet',   standardDose: '150mg bd',    pregnancyCategory: 'B', controlledCategory: ControlledCategory.OTC },
    { brandName: 'Tenivast',       genericName: 'Lisinopril',               drugClass: 'ACE inhibitor',     dosageForm: 'Tablet',   standardDose: '5-40mg od',   pregnancyCategory: 'D', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Insulatard',     genericName: 'Insulin NPH',              drugClass: 'Insulin',           dosageForm: 'Vial',     standardDose: 'Individualized', pregnancyCategory: 'B', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Warfin',         genericName: 'Warfarin',                 drugClass: 'Anticoagulant',     dosageForm: 'Tablet',   standardDose: '2-10mg od',   pregnancyCategory: 'X', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Doxycycline',    genericName: 'Doxycycline',              drugClass: 'Antibiotic',        dosageForm: 'Capsule',  standardDose: '100mg bd',    pregnancyCategory: 'D', controlledCategory: ControlledCategory.PRESCRIPTION_ONLY },
    { brandName: 'Omeprazole',     genericName: 'Omeprazole',               drugClass: 'PPI',               dosageForm: 'Capsule',  standardDose: '20-40mg od',  pregnancyCategory: 'C', controlledCategory: ControlledCategory.OTC },
    { brandName: 'Vitacimin',      genericName: 'Ascorbic Acid',            drugClass: 'Vitamin',           dosageForm: 'Tablet',   standardDose: '500-1000mg od', pregnancyCategory: 'A', controlledCategory: ControlledCategory.OTC },
    { brandName: 'Ferrograd',      genericName: 'Ferrous Sulphate',         drugClass: 'Iron supplement',   dosageForm: 'Tablet',   standardDose: '200mg od-tds', pregnancyCategory: 'A', controlledCategory: ControlledCategory.OTC },
    { brandName: 'Pethidine',      genericName: 'Pethidine',                drugClass: 'Opioid analgesic',  dosageForm: 'Injection',standardDose: '25-100mg IM', pregnancyCategory: 'C', controlledCategory: ControlledCategory.SCHEDULE_II },
    { brandName: 'Diazepam',       genericName: 'Diazepam',                 drugClass: 'Benzodiazepine',    dosageForm: 'Tablet',   standardDose: '2-10mg od',   pregnancyCategory: 'D', controlledCategory: ControlledCategory.SCHEDULE_III },
  ]

  const drugs: Record<string, string> = {}
  for (const d of drugData) {
    const drug = await prisma.drug.upsert({
      where:  { id: `drug-${d.genericName.toLowerCase().replace(/\W+/g,'-')}` },
      update: {},
      create: { id: `drug-${d.genericName.toLowerCase().replace(/\W+/g,'-')}`, ...d },
    })
    drugs[d.genericName] = drug.id
  }
  console.log(`✅ Drugs: ${Object.keys(drugs).length} seeded`)

  // ── 4. Drug interactions ──────────────────────────────
  const interactions = [
    { a: 'Warfarin',      b: 'Ibuprofen',       sev: 'MAJOR',           desc: 'NSAIDs increase bleeding risk significantly with warfarin.' },
    { a: 'Warfarin',      b: 'Atorvastatin',    sev: 'MODERATE',        desc: 'Statins may potentiate anticoagulant effect — monitor INR.' },
    { a: 'Metformin',     b: 'Ibuprofen',        sev: 'MODERATE',        desc: 'NSAIDs may impair renal function, increasing metformin accumulation and lactic acidosis risk.' },
    { a: 'Amoxicillin',   b: 'Warfarin',         sev: 'MODERATE',        desc: 'Antibiotics may alter gut flora affecting vitamin K synthesis — monitor INR.' },
    { a: 'Atorvastatin',  b: 'Azithromycin',     sev: 'MAJOR',           desc: 'Macrolides inhibit CYP3A4 — increased statin levels, myopathy risk.' },
    { a: 'Diazepam',      b: 'Pethidine',        sev: 'CONTRAINDICATED', desc: 'CNS depression compounded — respiratory depression risk.' },
    { a: 'Lisinopril',    b: 'Ibuprofen',        sev: 'MAJOR',           desc: 'NSAIDs reduce ACE inhibitor efficacy and increase nephrotoxicity risk.' },
    { a: 'Doxycycline',   b: 'Metronidazole',    sev: 'MINOR',           desc: 'Additive GI side effects — take with food.' },
  ]

  for (const ix of interactions) {
    const aId = drugs[ix.a]
    const bId = drugs[ix.b]
    if (!aId || !bId) continue
    await prisma.drugInteraction.upsert({
      where:  { drugAId_drugBId: { drugAId: aId, drugBId: bId } },
      update: {},
      create: {
        drugAId:     aId,
        drugBId:     bId,
        severity:    ix.sev as any,
        description: ix.desc,
        source:      'BNF / WHO',
      },
    })
  }
  console.log(`✅ Drug interactions: ${interactions.length} seeded`)

  // ── 5. Inventory (demo stock) ─────────────────────────
  const pharmacistUser = users.find(u => u.role === 'PHARMACIST')!
  const invItems = [
    { genericName: 'Amoxicillin',   qty: 120,  cost: 240,  price: 320,  reorder: 50,  batch: 'AMX-24-08', exp: '2026-08-31' },
    { genericName: 'Metformin',     qty: 200,  cost: 130,  price: 180,  reorder: 40,  batch: 'MET-24-11', exp: '2027-03-31' },
    { genericName: 'Paracetamol',   qty: 500,  cost: 50,   price: 85,   reorder: 100, batch: 'PCM-24-09', exp: '2026-09-30' },
    { genericName: 'Salbutamol',    qty: 8,    cost: 450,  price: 650,  reorder: 20,  batch: 'SAL-24-07', exp: '2025-12-31' },
    { genericName: 'Atorvastatin',  qty: 80,   cost: 180,  price: 250,  reorder: 30,  batch: 'ATO-24-10', exp: '2027-01-31' },
    { genericName: 'Ibuprofen',     qty: 300,  cost: 40,   price: 70,   reorder: 80,  batch: 'IBU-24-06', exp: '2026-06-30' },
    { genericName: 'Metronidazole', qty: 200,  cost: 65,   price: 95,   reorder: 60,  batch: 'MET-09',    exp: '2025-07-31' },
    { genericName: 'Warfarin',      qty: 60,   cost: 90,   price: 140,  reorder: 20,  batch: 'WAR-24-05', exp: '2026-05-31' },
    { genericName: 'Omeprazole',    qty: 150,  cost: 55,   price: 90,   reorder: 50,  batch: 'OMP-24-10', exp: '2026-10-31' },
    { genericName: 'Ascorbic Acid', qty: 400,  cost: 80,   price: 120,  reorder: 100, batch: 'VTC-24-12', exp: '2026-12-31' },
  ]

  for (const item of invItems) {
    const drugId = drugs[item.genericName]
    if (!drugId) continue
    await prisma.inventory.upsert({
      where:  { branchId_drugId_batchNo: { branchId: branch.id, drugId, batchNo: item.batch } },
      update: { quantityOnHand: item.qty },
      create: {
        branchId:      branch.id,
        drugId,
        batchNo:       item.batch,
        expiryDate:    new Date(item.exp),
        quantityOnHand: item.qty,
        reorderLevel:  item.reorder,
        unitCost:      item.cost,
        sellingPrice:  item.price,
        markupPercent: Number(((item.price - item.cost) / item.cost * 100).toFixed(2)),
      },
    })
  }
  console.log(`✅ Inventory: ${invItems.length} items seeded`)

  // ── 6. Demo patients ──────────────────────────────────
  // Africa-first: varying levels of contact info provided
  const patientData = [
    // Full details
    { firstName: 'Mary',   lastName: 'Wanjiku', phone: '+254 722 001 234', dateOfBirth: new Date('1972-03-15'), gender: 'F', nhifNo: 'NHIF001234', insurance: 'AAR',      chronicConditions: ['T2DM', 'Hypertension'] },
    // Has phone, no ID
    { firstName: 'Ahmed',  lastName: 'Khalid',  phone: '+254 733 002 345', dateOfBirth: new Date('1957-07-22'), gender: 'M', nhifNo: 'NHIF005678', insurance: 'NHIF',     chronicConditions: ['T1DM'] },
    // Has phone, no insurance
    { firstName: 'James',  lastName: 'Omondi',  phone: '+254 711 003 456', dateOfBirth: new Date('1980-11-08'), gender: 'M', insurance: null,      chronicConditions: ['Hyperlipidemia'] },
    // Walk-in patient — no phone, no ID (Africa reality)
    { firstName: 'Fatuma', lastName: 'Ali',      phone: null,               dateOfBirth: new Date('1993-05-20'), gender: 'F', insurance: 'Self-pay', chronicConditions: [] },
    // Known by nickname only, no DOB given
    { firstName: 'John',   lastName: 'Kariuki',  phone: '+254 714 005 678', nickname: 'JK', dateOfBirth: null, gender: 'M', insurance: 'NHIF', chronicConditions: [] },
    // Only name given — absolute minimum
    { firstName: 'Esther', lastName: 'Mwende',   phone: null,               dateOfBirth: null, gender: null,  insurance: null, chronicConditions: [] },
  ]

  for (const p of patientData) {
    await prisma.patient.upsert({
      where:  { id: `patient-${p.firstName.toLowerCase()}-${p.lastName.toLowerCase()}` },
      update: {},
      create: {
        id:                `patient-${p.firstName.toLowerCase()}-${p.lastName.toLowerCase()}`,
        branchId:          branch.id,
        firstName:         p.firstName,
        lastName:          p.lastName,
        nickname:          (p as any).nickname ?? null,
        phone:             p.phone ?? null,
        dateOfBirth:       p.dateOfBirth ?? null,
        gender:            p.gender ?? null,
        nhifNo:            (p as any).nhifNo ?? null,
        insurance:         p.insurance ?? null,
        chronicConditions: p.chronicConditions,
      },
    })
  }
  console.log(`✅ Patients: ${patientData.length} seeded (including minimal-info patients)`)

  // ── 7. Sample allergy ─────────────────────────────────
  const mary = await prisma.patient.findFirst({ where: { firstName: 'Mary', branchId: branch.id } })
  if (mary) {
    await prisma.allergy.upsert({
      where:  { id: 'allergy-mary-sulfa' },
      update: {},
      create: {
        id:          'allergy-mary-sulfa',
        patientId:   mary.id,
        allergen:    'Sulfonamides',
        allergenType:'DRUG',
        severity:    'SEVERE',
        reaction:    'Stevens-Johnson syndrome',
        verifiedById: pharmacistUser.id,
        verifiedAt:  new Date(),
      },
    })
  }
  console.log('✅ Sample allergy seeded')

  console.log('\n🎉 Seed complete!')
  console.log('─────────────────────────────────────────')
  console.log('Login credentials:')
  console.log('  Super Admin  → admin@pharmacare.co.ke    / Admin@1234!')
  console.log('  Pharmacist   → pharmacist@pharmacare.co.ke / Pharma@1234!')
  console.log('  Cashier      → cashier@pharmacare.co.ke  / Cash@1234!')
  console.log('  Technician   → tech@pharmacare.co.ke     / Tech@1234!')
  console.log('─────────────────────────────────────────')
}

main()
  .catch(e => { console.error('❌ Seed failed:', e); process.exit(1) })
  .finally(async () => await prisma.$disconnect())