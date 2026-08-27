(function(){
  'use strict';
  /* =========================================================================
     PA Training EMR — application script
     Sections below: utilities, data (patients/labs/imaging/procedures),
     state + persistence, rendering, notes module, orders module, init.
  ========================================================================= */

  /* ---------------------------------------------------------------
     Utilities
  --------------------------------------------------------------- */
  function uid(prefix){ return prefix+'_'+Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4); }

  function calcAge(dobStr){
    const dob = new Date(dobStr+'T00:00:00');
    const now = new Date();
    let age = now.getFullYear()-dob.getFullYear();
    const m = now.getMonth()-dob.getMonth();
    if (m<0 || (m===0 && now.getDate()<dob.getDate())) age--;
    return age;
  }

  function fmtDateTime(ts){
    const d = new Date(ts);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const yy = d.getFullYear();
    let h = d.getHours();
    const min = String(d.getMinutes()).padStart(2,'0');
    const ap = h>=12 ? 'PM':'AM';
    h = h%12; if (h===0) h=12;
    return mm+'/'+dd+'/'+yy+' '+h+':'+min+' '+ap;
  }
  function fmtDate(ts){
    const d = new Date(ts);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return mm+'/'+dd+'/'+d.getFullYear();
  }
  function fmtTimeOnly(ts){
    const d = new Date(ts);
    let h = d.getHours();
    const ampm = h>=12 ? 'PM' : 'AM';
    h = h%12; if (h===0) h = 12;
    return h+':'+String(d.getMinutes()).padStart(2,'0')+' '+ampm;
  }
  function escapeHtml(s){
    if (s===undefined || s===null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function nl2br(s){ return escapeHtml(s).replace(/\n/g,'<br>'); }

  /* Simple localStorage wrapper with graceful fallback */
  const STORAGE_KEY = 'pa_training_emr_v1';
  function loadStoredState(){
    try{
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    }catch(e){ return null; }
  }
  function saveStoredState(){
    try{
      const payload = { notes: STATE.notes, orders: STATE.orders, clinicianName: STATE.clinicianName, customPatients: STATE.customPatients, labOverrides: STATE.labOverrides, patientOverrides: STATE.patientOverrides, deletedPatientIds: STATE.deletedPatientIds, vitals: STATE.vitals, io: STATE.io };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }catch(e){ /* localStorage unavailable — training session continues in-memory only */ }
  }

  /* ---------------------------------------------------------------
     LAB LIBRARY
     Every orderable lab is a "panel" (even single-analyte tests, for a
     consistent data shape). Numeric components carry a normal reference
     range; a patient's labProfile can override any component's value by
     its component id. Values are fixed per patient (not randomized) so
     a given case is reproducible for every student who opens it.
  --------------------------------------------------------------- */
  const BMP_COMPONENTS = [
    {id:'na',   label:'Sodium',      unit:'mmol/L',   range:[136,145], def:140, dec:0},
    {id:'k',    label:'Potassium',   unit:'mmol/L',   range:[3.5,5.0], def:4.2, dec:1, critLow:2.5, critHigh:6.5},
    {id:'cl',   label:'Chloride',    unit:'mmol/L',   range:[98,107],  def:102, dec:0},
    {id:'co2',  label:'CO2 (Bicarb)',unit:'mmol/L',   range:[22,29],   def:25, dec:0},
    {id:'bun',  label:'BUN',         unit:'mg/dL',    range:[7,20],    def:14, dec:0},
    {id:'cr',   label:'Creatinine',  unit:'mg/dL',    range:[0.6,1.2], def:0.9, dec:1},
    {id:'glu',  label:'Glucose',     unit:'mg/dL',    range:[70,99],   def:95, dec:0}
  ];
  const LIVER_COMPONENTS = [
    {id:'ast',      label:'AST',        unit:'U/L',   range:[10,40],  def:22, dec:0},
    {id:'alt',      label:'ALT',        unit:'U/L',   range:[7,56],   def:25, dec:0},
    {id:'alkphos',  label:'Alk Phos',   unit:'U/L',   range:[44,147], def:80, dec:0},
    {id:'tbili',    label:'Total Bili', unit:'mg/dL', range:[0.1,1.2],def:0.6, dec:1},
    {id:'albumin',  label:'Albumin',    unit:'g/dL',  range:[3.5,5.0],def:4.2, dec:1},
    {id:'tprotein', label:'Total Protein', unit:'g/dL', range:[6.0,8.3], def:7.0, dec:1}
  ];

  const LAB_PANELS = {
    cbc: { label:'CBC with Differential', category:'Hematology', kind:'numeric', components:[
      {id:'wbc',   label:'WBC',       unit:'x10^3/uL', range:[4.5,11.0], def:7.2,  dec:1, critHigh:30},
      {id:'rbc',   label:'RBC',       unit:'x10^6/uL', range:[4.2,5.9],  def:4.8,  dec:1},
      {id:'hgb',   label:'Hemoglobin',unit:'g/dL',     range:[12.0,16.0],def:13.5, dec:1, critLow:6.5},
      {id:'hct',   label:'Hematocrit',unit:'%',        range:[36,46],    def:40,   dec:0},
      {id:'mcv',   label:'MCV',       unit:'fL',       range:[80,100],   def:90,   dec:0},
      {id:'mch',   label:'MCH',       unit:'pg',       range:[27,33],    def:30,   dec:1},
      {id:'mchc',  label:'MCHC',      unit:'g/dL',     range:[32,36],    def:34,   dec:1},
      {id:'rdw',   label:'RDW',       unit:'%',        range:[11.5,14.5],def:13.0, dec:1},
      {id:'plt',   label:'Platelets', unit:'x10^3/uL', range:[150,400],  def:250,  dec:0, critLow:20},
      {id:'segs',  label:'Segs (Neutrophils)', unit:'%', range:[40,70], def:55, dec:0},
      {id:'bands', label:'Bands',     unit:'%',        range:[0,5],      def:2,    dec:0},
      {id:'eos',   label:'Eosinophils',unit:'%',       range:[1,4],      def:2,    dec:0},
      {id:'baso',  label:'Basophils', unit:'%',        range:[0,1],      def:0.5,  dec:1},
      {id:'lymphs',label:'Lymphocytes',unit:'%',       range:[20,40],    def:30,   dec:0},
      {id:'monos', label:'Monocytes', unit:'%',        range:[2,8],      def:5,    dec:1}
    ]},
    bmp: { label:'Basic Metabolic Panel (BMP)', category:'Chemistry', kind:'numeric', components: BMP_COMPONENTS },
    cmp: { label:'Comprehensive Metabolic Panel (CMP)', category:'Chemistry', kind:'numeric', components: BMP_COMPONENTS.concat(LIVER_COMPONENTS) },
    magphos: { label:'Magnesium & Phosphorus', category:'Chemistry', kind:'numeric', components:[
      {id:'mg',   label:'Magnesium',  unit:'mg/dL', range:[1.6,2.4], def:2.0, dec:1},
      {id:'phos', label:'Phosphorus', unit:'mg/dL', range:[2.5,4.5], def:3.4, dec:1}
    ]},
    troponin: { label:'Troponin', category:'Cardiac', kind:'numeric', components:[
      {id:'troponin', label:'Troponin I', unit:'ng/mL', range:[0,0.04], def:0.01, dec:2, critHigh:0.5}
    ]},
    bnp: { label:'BNP', category:'Cardiac', kind:'numeric', components:[
      {id:'bnp', label:'BNP', unit:'pg/mL', range:[0,100], def:35, dec:0}
    ]},
    lactate: { label:'Lactate', category:'Chemistry', kind:'numeric', components:[
      {id:'lactate', label:'Lactate', unit:'mmol/L', range:[0.5,2.2], def:1.1, dec:1, critHigh:4}
    ]},
    lipase: { label:'Lipase', category:'Chemistry', kind:'numeric', components:[
      {id:'lipase', label:'Lipase', unit:'U/L', range:[10,140], def:45, dec:0}
    ]},
    coags: { label:'Coagulation Panel (PT/INR/PTT)', category:'Hematology', kind:'numeric', components:[
      {id:'pt',  label:'PT',  unit:'sec', range:[11,13.5], def:12.2, dec:1},
      {id:'inr', label:'INR', unit:'',    range:[0.8,1.1], def:1.0, dec:1},
      {id:'ptt', label:'PTT', unit:'sec', range:[25,35],   def:29, dec:0}
    ]},
    tsh: { label:'TSH', category:'Endocrine', kind:'numeric', components:[
      {id:'tsh', label:'TSH', unit:'mIU/L', range:[0.4,4.0], def:2.1, dec:1}
    ]},
    ft4: { label:'Free T4', category:'Endocrine', kind:'numeric', components:[
      {id:'ft4', label:'Free T4', unit:'ng/dL', range:[0.9,2.1], def:1.3, dec:1}
    ]},
    hba1c: { label:'Hemoglobin A1c', category:'Endocrine', kind:'numeric', components:[
      {id:'hba1c', label:'HbA1c', unit:'%', range:[4.0,5.6], def:5.3, dec:1}
    ]},
    ddimer: { label:'D-dimer', category:'Hematology', kind:'numeric', components:[
      {id:'ddimer', label:'D-dimer', unit:'ug/mL FEU', range:[0,0.50], def:0.25, dec:2}
    ]},
    abg: { label:'Arterial Blood Gas (ABG)', category:'Chemistry', kind:'numeric', components:[
      {id:'ph',   label:'pH',    unit:'',     range:[7.35,7.45], def:7.40, dec:2},
      {id:'pco2', label:'pCO2', unit:'mmHg', range:[35,45],     def:40, dec:0},
      {id:'po2',  label:'pO2',  unit:'mmHg', range:[80,100],    def:92, dec:0},
      {id:'hco3', label:'HCO3', unit:'mmol/L', range:[22,26],   def:24, dec:0}
    ]},
    lipid: { label:'Lipid Panel', category:'Chemistry', kind:'numeric', components:[
      {id:'ldl', label:'LDL',        unit:'mg/dL', range:[0,99],  def:95, dec:0},
      {id:'hdl', label:'HDL',        unit:'mg/dL', range:[40,60], def:50, dec:0},
      {id:'tg',  label:'Triglycerides', unit:'mg/dL', range:[0,149], def:120, dec:0},
      {id:'totalchol', label:'Total Cholesterol', unit:'mg/dL', range:[0,199], def:180, dec:0}
    ]},
    ua: { label:'Urinalysis (UA)', category:'Urine', kind:'numeric', components:[
      {id:'uacolor',   label:'Color',    unit:'', range:[0,1], def:0, dec:0,
        labels:{0:'Yellow',1:'Pale yellow',2:'Amber',3:'Red',4:'Brown'}, rangeLabel:'Yellow'},
      {id:'uaclarity', label:'Clarity',  unit:'', range:[0,0], def:0, dec:0,
        labels:{0:'Clear',1:'Slightly cloudy',2:'Cloudy',3:'Turbid'}, rangeLabel:'Clear'},
      {id:'uasg',      label:'Specific Gravity', unit:'', range:[1.005,1.030], def:1.018, dec:3, rangeLabel:'1.005–1.030'},
      {id:'uaph',      label:'pH',       unit:'', range:[4.5,8.0], def:6.0, dec:1, rangeLabel:'4.5–8.0'},
      {id:'uaprotein', label:'Protein',  unit:'', range:[0,0], def:0, dec:0,
        labels:{0:'Negative',1:'Trace',2:'1+',3:'2+',4:'3+',5:'4+'}, rangeLabel:'Negative'},
      {id:'uaglucose', label:'Glucose',  unit:'', range:[0,0], def:0, dec:0,
        labels:{0:'Negative',1:'Trace',2:'1+',3:'2+',4:'3+',5:'4+'}, rangeLabel:'Negative'},
      {id:'uaketones', label:'Ketones',  unit:'', range:[0,0], def:0, dec:0,
        labels:{0:'Negative',1:'Trace',2:'Small',3:'Moderate',4:'Large'}, rangeLabel:'Negative'},
      {id:'uablood',   label:'Blood',    unit:'', range:[0,0], def:0, dec:0,
        labels:{0:'Negative',1:'Trace',2:'Small',3:'Moderate',4:'Large'}, rangeLabel:'Negative'},
      {id:'ualeukest', label:'Leukocyte Esterase', unit:'', range:[0,0], def:0, dec:0,
        labels:{0:'Negative',1:'Trace',2:'Small',3:'Moderate',4:'Large'}, rangeLabel:'Negative'},
      {id:'uanitrites',label:'Nitrites', unit:'', range:[0,0], def:0, dec:0,
        labels:{0:'Negative',1:'Positive'}, rangeLabel:'Negative'},
      {id:'uawbc',     label:'WBC',      unit:'/hpf', range:[0,5], def:2, dec:0},
      {id:'uarbc',     label:'RBC',      unit:'/hpf', range:[0,2], def:1, dec:0},
      {id:'uacasts',   label:'Casts',    unit:'', range:[0,2], def:0, dec:0,
        labels:{0:'None seen',1:'Occ. hyaline',2:'Hyaline',3:'Granular',4:'Waxy'}, rangeLabel:'None–hyaline'},
      {id:'uabacteria',label:'Bacteria', unit:'', range:[0,1], def:0, dec:0,
        labels:{0:'None',1:'Few',2:'Moderate',3:'Many'}, rangeLabel:'None–few'}
    ]},
    urinelytes: { label:'Urine Studies (Sodium, Creatinine, Osmolality, FENa)', category:'Urine', kind:'numeric', components:[
      {id:'urna',  label:'Urine Sodium',      unit:'mEq/L',   range:[20,110], def:60,  dec:0},
      {id:'urcr',  label:'Urine Creatinine',  unit:'mg/dL',   range:[20,300], def:100, dec:0},
      {id:'urosm', label:'Urine Osmolality',  unit:'mOsm/kg', range:[500,850],def:600, dec:0},
      {id:'fena',  label:'FENa',              unit:'%',       range:[1,2],    def:1.5, dec:2}
    ]},
    uacr: { label:'Urine Albumin-to-Creatinine Ratio (UACR)', category:'Urine', kind:'numeric', components:[
      {id:'ualb',    label:'Urine Albumin',     unit:'mg/L', range:[0,30], def:10,  dec:0},
      {id:'urcr',    label:'Urine Creatinine',  unit:'mg/dL',range:[20,300],def:100,dec:0},
      {id:'uacrval', label:'UACR',              unit:'mg/g', range:[0,30], def:15,  dec:0}
    ]},
    urinecx: { label:'Urine Culture', category:'Microbiology', kind:'text',
      defaultText:'Pending — no growth at 24 hours. Final results (with sensitivities, if positive) available at 48–72 hours.' },
    bloodcx: { label:'Blood Cultures x2', category:'Microbiology', kind:'text',
      defaultText:'Pending — no growth to date on either bottle set. Final results in 5 days if no growth.' },
    typescreen: { label:'Type & Screen', category:'Blood Bank', kind:'text',
      defaultText:'Blood type O positive. Antibody screen: negative.' },
    ogtt: { label:'Oral Glucose Tolerance Test (OGTT)', category:'Endocrine', kind:'numeric', components:[
      {id:'glu',    label:'Fasting Glucose',   unit:'mg/dL', range:[70,99],  def:95,  dec:0},
      {id:'glu2hr', label:'2-Hour Glucose (post 75g load)', unit:'mg/dL', range:[0,139], def:110, dec:0}
    ]},
    reproHormones: { label:'Reproductive Hormone Panel (Testosterone, DHEA-S, Prolactin)', category:'Endocrine', kind:'numeric', components:[
      {id:'freeT',    label:'Free Testosterone',  unit:'pg/mL', range:[0.1,4.2], def:1.5, dec:1},
      {id:'totalT',   label:'Total Testosterone', unit:'ng/dL', range:[8,60],    def:35,  dec:0},
      {id:'dheas',    label:'DHEA-S',             unit:'µg/dL', range:[45,270], def:150, dec:0},
      {id:'prolactin',label:'Prolactin',          unit:'ng/mL', range:[4,23],    def:10,  dec:1}
    ]},
    hcgQual: { label:'Urine/Serum Pregnancy Test (Qualitative hCG)', category:'Endocrine', kind:'numeric', components:[
      {id:'hcgqual', label:'hCG, Qualitative', unit:'', range:[0,0], def:0, dec:0,
        labels:{0:'Negative',1:'Positive'}, rangeLabel:'Negative' }
    ]},
    hcgQuant: { label:'Quantitative Serum Beta-hCG', category:'Endocrine', kind:'numeric', components:[
      {id:'hcgquant', label:'Beta-hCG, Quantitative', unit:'mIU/mL', range:[0,5], def:0, dec:0, rangeLabel:'<5 (non-pregnant)'}
    ]},
    inflamMarkers: { label:'Inflammatory Markers (ESR/CRP)', category:'Chemistry', kind:'numeric', components:[
      {id:'esr', label:'ESR', unit:'mm/hr', range:[0,20], def:10, dec:0},
      {id:'crp', label:'CRP', unit:'mg/L',  range:[0,10], def:3,  dec:0}
    ]},
    arthritisSerology: { label:'Autoimmune/Infectious Arthritis Serologies (RF, ANA, Lyme Ab)', category:'Serology', kind:'numeric', components:[
      {id:'rf',     label:'Rheumatoid Factor', unit:'', range:[0,0], def:0, dec:0, labels:{0:'Negative',1:'Positive'}, rangeLabel:'Negative'},
      {id:'ana',    label:'ANA',               unit:'', range:[0,0], def:0, dec:0, labels:{0:'Negative',1:'Positive'}, rangeLabel:'Negative'},
      {id:'lymeab', label:'Lyme Antibody',     unit:'', range:[0,0], def:0, dec:0, labels:{0:'Negative',1:'Positive'}, rangeLabel:'Negative'}
    ]},
    stiNaat: { label:'Gonorrhea/Chlamydia NAAT (Endocervical/Urine)', category:'Microbiology', kind:'text',
      defaultText:'Neisseria gonorrhoeae NAAT: Negative. Chlamydia trachomatis NAAT: Negative.' },
    hivAgAb: { label:'HIV Ag/Ab Combo (4th Generation)', category:'Serology', kind:'text',
      defaultText:'Non-reactive.' },
    rpr: { label:'RPR (Syphilis Screen)', category:'Serology', kind:'text',
      defaultText:'Non-reactive.' }
  };

  /* CSF panel is only produced via the Lumbar Puncture procedure, not
     directly orderable as a "lab" from the list — kept separate. */
  const CSF_COMPONENTS = [
    {id:'csfopening', label:'Opening Pressure', unit:'cmH2O', range:[10,20], def:14, dec:0},
    {id:'csfwbc',     label:'CSF WBC',   unit:'/uL',   range:[0,5],   def:2, dec:0},
    {id:'csfrbc',     label:'CSF RBC',   unit:'/uL',   range:[0,0],   def:0, dec:0},
    {id:'csfprotein', label:'Protein',   unit:'mg/dL', range:[15,45], def:30, dec:0},
    {id:'csfglucose', label:'Glucose',   unit:'mg/dL', range:[40,70], def:55, dec:0}
  ];
  const CSF_DEFAULT_GRAM = 'No organisms seen on Gram stain.';

  /* Synovial fluid panel is only produced via the Arthrocentesis procedure,
     not directly orderable as a "lab" from the list — mirrors the CSF /
     Lumbar Puncture pattern above. */
  const SYNOVIAL_COMPONENTS = [
    {id:'synWbc', label:'Synovial Fluid WBC',    unit:'/µL', range:[0,200], def:100, dec:0},
    {id:'synPmn', label:'Synovial Fluid % PMNs', unit:'%',   range:[0,25],  def:10,  dec:0}
  ];
  const SYNOVIAL_DEFAULT_GRAM = 'No organisms seen on Gram stain.';

  function getActiveLabStage(patientId){
    const entry = STATE.labOverrides && STATE.labOverrides[patientId];
    if (!entry) return null;
    return entry.stages.find(function(s){ return s.id===entry.activeStageId; }) || null;
  }

  /* Shared line builder: given a component definition and a raw numeric value,
     apply the reference range / critical thresholds and return a display line.
     `compId` and `raw` are carried through so the Trends view can pivot on them.
     Some components (e.g. urinalysis dipstick fields) are semi-quantitative:
     the underlying value is still a plain ordinal number for range/flag/trend
     purposes, but comp.labels maps that number to the string a clinician
     actually expects to read (e.g. 2 -> '1+'). comp.rangeLabel similarly lets
     a component show a human reference like 'Negative' instead of the raw
     numeric bounds — both are optional and every existing numeric component
     is unaffected. */
  function buildLabLine(comp, val){
    let flag = '';
    if (comp.critHigh!==undefined && val>=comp.critHigh) flag='C';
    else if (comp.critLow!==undefined && val<=comp.critLow) flag='C';
    else if (val>comp.range[1]) flag='H';
    else if (val<comp.range[0]) flag='L';
    const displayValue = (comp.labels && comp.labels[val]!==undefined) ? comp.labels[val] : val.toFixed(comp.dec);
    const displayRange = comp.rangeLabel || comp.range.join('\u2013');
    return { compId: comp.id, raw: val, value: displayValue, flag: flag,
             unit: comp.unit, label: comp.label, range: displayRange };
  }

  function getLabComponentValue(patient, comp){
    const stage = getActiveLabStage(patient.id);
    const stageVal = (stage && stage.profile) ? stage.profile[comp.id] : undefined;
    const profile = patient.labProfile || {};
    const baseVal = profile[comp.id];
    const val = (stageVal!==undefined) ? stageVal : ((baseVal!==undefined) ? baseVal : comp.def);
    return buildLabLine(comp, val);
  }

  /* ---------------------------------------------------------------
     PRIOR / OUTSIDE RECORDS
     Historical results are frozen at authoring time rather than
     generated on demand: a lab drawn two years ago must not change
     when the facilitator advances a case stage. Values the author
     leaves blank fall back to this patient's baseline profile, then
     to the component default, so only the analytes that matter for
     the trend have to be entered.
  --------------------------------------------------------------- */
  function buildHistoricalLabResult(patient, panelId, values){
    const panel = LAB_PANELS[panelId];
    if (!panel) return null;
    const vals = values || {};
    if (panel.kind==='text'){
      const txt = (typeof vals.text==='string' && vals.text.trim()!=='')
        ? vals.text
        : ((patient.labTextProfile||{})[panelId] || panel.defaultText);
      return { kind:'text', text: txt, lines: null };
    }
    const profile = patient.labProfile || {};
    const lines = panel.components.map(function(comp){
      const entered = vals[comp.id];
      const val = (entered!==undefined && entered!==null && entered!=='')
        ? parseFloat(entered)
        : ((profile[comp.id]!==undefined) ? profile[comp.id] : comp.def);
      return buildLabLine(comp, isNaN(val) ? comp.def : val);
    });
    return { kind:'numeric', lines: lines, text: null };
  }

  /* Accepts 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'. Parsed as local time so a
     date entered as 2023-04-12 does not display as 2023-04-11 west of UTC. */
  function parseHistoryDate(str){
    if (!str) return null;
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) { const d = new Date(str); return isNaN(d.getTime()) ? null : d.getTime(); }
    return new Date(+m[1], +m[2]-1, +m[3], m[4]?+m[4]:9, m[5]?+m[5]:0).getTime();
  }

  function buildPriorOrders(patient){
    const out = [];
    const src = patient.priorRecords || {};
    const defaultBy = 'Outside records';

    (src.labs||[]).forEach(function(e){
      const ts = parseHistoryDate(e.date);
      const panel = LAB_PANELS[e.panelId];
      if (ts===null || !panel) return;
      const result = buildHistoricalLabResult(patient, e.panelId, e.values);
      out.push({
        id: uid('ord'), category:'lab', itemId: e.panelId, label: panel.label,
        medData: null, historical: true,
        orderedBy: e.orderedBy || defaultBy, orderedAt: ts, resultAt: ts,
        status: 'resulted', result: result,
        critical: !!(result.lines && result.lines.some(function(l){ return l.flag==='C'; })),
        expanded: false
      });
    });

    (src.imaging||[]).forEach(function(e){
      const ts = parseHistoryDate(e.date);
      const t = IMAGING_TYPES[e.typeId];
      if (ts===null || !t) return;
      const findings = (e.findings && e.findings.trim()) ? e.findings : t.defFindings;
      const impression = (e.impression && e.impression.trim()) ? e.impression : t.defImpression;
      const text = 'EXAMINATION: '+t.exam+'\n'+
        'DATE OF SERVICE: '+fmtDate(ts)+'\n'+
        'SOURCE: '+(e.orderedBy || defaultBy)+'\n\n'+
        'FINDINGS:\n'+findings+'\n\nIMPRESSION:\n'+impression;
      out.push({
        id: uid('ord'), category:'imaging', itemId: e.typeId, label: t.label,
        medData: null, historical: true,
        orderedBy: e.orderedBy || defaultBy, orderedAt: ts, resultAt: ts,
        status: 'resulted', result: { kind:'text', text: text },
        critical: false, expanded: false
      });
    });

    (src.procedures||[]).forEach(function(e){
      const ts = parseHistoryDate(e.date);
      const pr = PROCEDURES[e.procId];
      if (ts===null || !pr) return;
      const text = 'PROCEDURE: '+pr.label+'\n'+
        'DATE OF SERVICE: '+fmtDate(ts)+'\n'+
        'INDICATION: '+(e.indication || pr.indication)+'\n'+
        'SOURCE: '+(e.orderedBy || defaultBy)+'\n\n'+
        ((e.note && e.note.trim()) ? e.note : pr.note);
      out.push({
        id: uid('ord'), category:'procedure', itemId: e.procId, label: pr.label,
        medData: null, historical: true,
        orderedBy: e.orderedBy || defaultBy, orderedAt: ts, resultAt: ts,
        status: 'resulted', result: { kind:'text', text: text },
        critical: false, expanded: false
      });
    });

    (patient.activeMeds||[]).forEach(function(e){
      const ts = parseHistoryDate(e.startDate) ;
      const drug = (e.drug||'').trim();
      if (!drug) return;
      const startTs = (ts===null) ? patient.admitAt : ts;
      const label = [drug, e.dose, e.route, e.frequency].filter(function(x){ return x && String(x).trim(); }).join(' ');
      const allergyHit = patientHasAllergyMatch(patient, drug);
      let text = 'ACTIVE MEDICATION (continued from prior to admission): '+label+'\n'+
        'STARTED: '+fmtDate(startTs)+'\n'+
        'INDICATION: '+(e.indication || '\u2014')+'\n'+
        'SOURCE: '+(e.orderedBy || 'Home medication list / outside records')+'\n\n';
      if (allergyHit){
        text += '\u26A0 ALLERGY ALERT: This medication may conflict with this patient\u2019s documented allergies ('+patient.allergies.join(', ')+'). Verify before continuing.\n\n';
      }
      text += 'Reconciled on admission and continued.';
      out.push({
        id: uid('ord'), category:'medication', itemId: 'prior_'+uid('med'), label: label,
        medData: { drug:drug, dose:e.dose||'', route:e.route||'', frequency:e.frequency||'',
                   prn: /PRN/i.test(e.frequency||''), indication: e.indication||'', label: label },
        historical: true,
        orderedBy: e.orderedBy || 'Home medication list', orderedAt: startTs, resultAt: startTs,
        status: 'resulted', result: { kind:'text', text: text },
        critical: allergyHit, expanded: false
      });
    });

    return out;
  }

  function buildLabResultText(patient, panelId){
    const panel = LAB_PANELS[panelId];
    if (panel.kind==='text'){
      const stage = getActiveLabStage(patient.id);
      const stageText = (stage && stage.textProfile) ? stage.textProfile[panelId] : undefined;
      const override = (patient.labTextProfile||{})[panelId];
      return { lines: null, text: (stageText!==undefined && stageText!=='') ? stageText : (override || panel.defaultText) };
    }
    const lines = panel.components.map(function(comp){
      return getLabComponentValue(patient, comp);
    });
    return { lines: lines, text: null };
  }

  function buildCsfResultText(patient){
    const overrideGram = (patient.csfGram!==undefined) ? patient.csfGram : CSF_DEFAULT_GRAM;
    const lines = CSF_COMPONENTS.map(function(comp){
      const profile = patient.labProfile || {};
      const raw = profile[comp.id];
      const val = (raw!==undefined) ? raw : comp.def;
      let flag='';
      if (val>comp.range[1]) flag='H'; else if (comp.range[1]>0 && val<comp.range[0]) flag='L';
      return { value: val.toFixed(comp.dec), flag: flag, unit: comp.unit, label: comp.label, range: comp.range.join('–') };
    });
    return { lines: lines, gram: overrideGram };
  }

  function buildSynovialResultText(patient){
    const overrideGram = (patient.synovialGram!==undefined) ? patient.synovialGram : SYNOVIAL_DEFAULT_GRAM;
    const lines = SYNOVIAL_COMPONENTS.map(function(comp){
      const profile = patient.labProfile || {};
      const raw = profile[comp.id];
      const val = (raw!==undefined) ? raw : comp.def;
      let flag='';
      if (val>comp.range[1]) flag='H'; else if (comp.range[1]>0 && val<comp.range[0]) flag='L';
      return { value: val.toFixed(comp.dec), flag: flag, unit: comp.unit, label: comp.label, range: comp.range.join('–') };
    });
    return { lines: lines, gram: overrideGram };
  }

  /* ---------------------------------------------------------------
     Build the lab order picker groups directly from LAB_PANELS
  --------------------------------------------------------------- */
  function buildLabOrderGroups(){
    const groups = {};
    const order = [];
    Object.keys(LAB_PANELS).forEach(function(id){
      const p = LAB_PANELS[id];
      if (!groups[p.category]){ groups[p.category]=[]; order.push(p.category); }
      groups[p.category].push({ id:id, label:p.label });
    });
    return order.map(function(cat){ return { category:cat, items:groups[cat] }; });
  }

  /* ---------------------------------------------------------------
     IMAGING LIBRARY — default (normal) report templates. A patient's
     imagingFindings[id] = {findings, impression} overrides the body of
     the report for that specific study on that specific patient.
  --------------------------------------------------------------- */
  const IMAGING_TYPES = {
    cxr: { label:'Chest X-ray (PA & lateral)', category:'Radiography', exam:'Chest radiograph, PA and lateral views.',
      defFindings:'Lungs are clear without focal consolidation, effusion, or pneumothorax. Cardiomediastinal silhouette is normal in size and contour. No acute osseous abnormality.',
      defImpression:'No acute cardiopulmonary process.' },
    ekg: { label:'12-Lead EKG', category:'Cardiology', exam:'12-lead electrocardiogram.',
      defFindings:'Normal sinus rhythm. Rate within normal limits. Normal axis and intervals. No acute ST-T wave changes.',
      defImpression:'Normal sinus rhythm; no acute changes.' },
    ctHead: { label:'CT Head without contrast', category:'CT', exam:'CT of the head without IV contrast.',
      defFindings:'No acute intracranial hemorrhage, mass effect, or midline shift. Gray-white differentiation is preserved. Ventricles and sulci are normal for age.',
      defImpression:'No acute intracranial abnormality.' },
    ctChestPE: { label:'CT Chest with contrast (PE protocol)', category:'CT', exam:'CT angiogram of the chest, pulmonary embolism protocol.',
      defFindings:'Pulmonary arteries opacify normally to the subsegmental level without filling defect. Lungs are clear. No effusion or pneumothorax.',
      defImpression:'No evidence of pulmonary embolism.' },
    ctAbdPelvis: { label:'CT Abdomen/Pelvis with contrast', category:'CT', exam:'CT of the abdomen and pelvis with IV contrast.',
      defFindings:'Liver, spleen, pancreas, adrenal glands, and kidneys are unremarkable. No free fluid or free air. Appendix is normal in caliber where visualized. No bowel obstruction.',
      defImpression:'No acute intra-abdominal process.' },
    usRuq: { label:'Right Upper Quadrant Ultrasound', category:'Ultrasound', exam:'Ultrasound of the right upper quadrant.',
      defFindings:'Gallbladder is normal in size with a thin wall and no stones or pericholecystic fluid. Common bile duct is normal in caliber. Liver parenchyma is homogeneous.',
      defImpression:'Normal right upper quadrant ultrasound.' },
    usAbd: { label:'Abdominal Ultrasound (general)', category:'Ultrasound', exam:'General abdominal ultrasound.',
      defFindings:'Liver, gallbladder, pancreas (as visualized), spleen, and kidneys are unremarkable. No ascites.',
      defImpression:'Unremarkable abdominal ultrasound.' },
    usRenal: { label:'Renal Ultrasound', category:'Ultrasound', exam:'Renal ultrasound, bilateral.',
      defFindings:'Kidneys are normal in size and echogenicity bilaterally. No hydronephrosis or calculus identified.',
      defImpression:'Normal renal ultrasound; no hydronephrosis.' },
    usDvt: { label:'Doppler Ultrasound, Lower Extremity (DVT study)', category:'Ultrasound', exam:'Venous duplex ultrasound of the lower extremity.',
      defFindings:'Common femoral, femoral, and popliteal veins are fully compressible with normal Doppler flow and augmentation. No echogenic thrombus identified.',
      defImpression:'No evidence of deep venous thrombosis.' },
    tte: { label:'Transthoracic Echocardiogram (TTE)', category:'Cardiology', exam:'Transthoracic echocardiogram.',
      defFindings:'Left ventricle is normal in size with an estimated ejection fraction of 60%. No significant valvular abnormality. No pericardial effusion.',
      defImpression:'Normal left ventricular systolic function; no significant structural abnormality.' },
    kub: { label:'KUB (Abdominal X-ray)', category:'Radiography', exam:'Abdominal radiograph (KUB).',
      defFindings:'Nonobstructive bowel gas pattern. No free air. No abnormal calcification.',
      defImpression:'Nonobstructive bowel gas pattern.' },
    mriBrain: { label:'MRI Brain', category:'MRI', exam:'MRI of the brain without and with contrast.',
      defFindings:'No acute infarct, hemorrhage, or enhancing lesion. Normal brain parenchyma for age.',
      defImpression:'No acute intracranial abnormality.' },
    xrExtremity: { label:'X-ray, Extremity', category:'Radiography', exam:'Radiograph of the affected extremity, multiple views.',
      defFindings:'No acute fracture or dislocation. Soft tissues are unremarkable. No osseous erosion or periosteal reaction.',
      defImpression:'No acute osseous abnormality.' },
    usPelvis: { label:'Pelvic Ultrasound (Transvaginal)', category:'Ultrasound', exam:'Transvaginal pelvic ultrasound.',
      defFindings:'Uterus is normal in size, shape, and echogenicity with a normal endometrial stripe. Both ovaries are normal in size and morphology without cystic or solid masses. No free fluid in the cul-de-sac.',
      defImpression:'Normal transvaginal pelvic ultrasound.' },
    usBreast: { label:'Breast Ultrasound', category:'Ultrasound', exam:'Targeted breast ultrasound.',
      defFindings:'No discrete solid or cystic mass. No skin thickening or architectural distortion. Normal breast parenchyma for the stated location.',
      defImpression:'No sonographic abnormality.' }
  };

  function buildImagingOrderGroups(){
    const groups = {};
    const order = [];
    Object.keys(IMAGING_TYPES).forEach(function(id){
      const t = IMAGING_TYPES[id];
      if (!groups[t.category]){ groups[t.category]=[]; order.push(t.category); }
      groups[t.category].push({ id:id, label:t.label });
    });
    return order.map(function(cat){ return { category:cat, items:groups[cat] }; });
  }

  function buildImagingReportText(patient, imgId, clinicianName){
    const t = IMAGING_TYPES[imgId];
    const custom = (patient.imagingFindings||{})[imgId] || {};
    const findings = custom.findings || t.defFindings;
    const impression = custom.impression || t.defImpression;
    const who = clinicianName ? ('Ordering provider: '+clinicianName) : 'Ordering provider: (not specified)';
    return 'EXAMINATION: '+t.exam+'\n'+
      'CLINICAL HISTORY: '+(patient.chiefComplaint||'—')+'\n'+who+'\n\n'+
      'FINDINGS:\n'+findings+'\n\n'+
      'IMPRESSION:\n'+impression;
  }

  /* ---------------------------------------------------------------
     PROCEDURES LIBRARY — placed orders auto-complete into a brief
     procedure note. Lumbar puncture additionally attaches CSF results.
  --------------------------------------------------------------- */
  const PROCEDURES = {
    foley: { label:'Foley Catheter Placement', category:'Bedside', indication:'Accurate urine output monitoring / urinary retention.',
      note:'A 16 Fr Foley catheter was inserted into the bladder under sterile technique. Balloon inflated with 10 mL sterile water, good return of urine confirmed. Catheter secured. No resistance or complication during placement.' },
    ngt: { label:'Nasogastric (NG) Tube Placement', category:'Bedside', indication:'Gastric decompression / decompress obstruction.',
      note:'A 14 Fr nasogastric tube was passed through the nares to the stomach without resistance. Placement confirmed by auscultation of insufflated air and aspiration of gastric contents. Tube secured at the nose.' },
    ivPeripheral: { label:'Peripheral IV Placement', category:'Bedside', indication:'Vascular access for fluids/medications.',
      note:'An 18-gauge peripheral IV catheter was placed in the left forearm under sterile technique on the first attempt. Good blood return obtained; line flushes easily without infiltration.' },
    centralLine: { label:'Central Venous Line Placement', category:'Invasive', indication:'Central venous access.',
      note:'A triple-lumen central venous catheter was placed in the right internal jugular vein under ultrasound guidance and sterile technique using Seldinger technique. No arterial puncture. Post-procedure chest x-ray recommended to confirm tip position and rule out pneumothorax.' },
    lp: { label:'Lumbar Puncture', category:'Invasive', indication:'CSF analysis.',
      note:'With the patient positioned in the lateral decubitus position, the L4-L5 interspace was identified and prepped/draped in sterile fashion. A 20-gauge spinal needle was advanced to the subarachnoid space without complication; clear CSF was obtained and sent for cell count, protein, glucose, Gram stain, and culture. Needle removed, dressing applied.' },
    paracentesis: { label:'Paracentesis', category:'Invasive', indication:'Diagnostic/therapeutic drainage of ascites.',
      note:'Under ultrasound guidance and sterile technique, a paracentesis needle/catheter was inserted into the left lower quadrant. Straw-colored ascitic fluid was drained and sent for cell count, albumin, and culture. Procedure tolerated well without complication.' },
    thoracentesis: { label:'Thoracentesis', category:'Invasive', indication:'Diagnostic/therapeutic drainage of pleural effusion.',
      note:'Under ultrasound guidance and sterile technique, a thoracentesis catheter was placed in the posterior right chest at the site of maximal effusion. Fluid was drained and sent for cell count, protein, LDH, and culture. Post-procedure the patient remained without dyspnea or chest pain; no pneumothorax on subsequent imaging.' },
    arthrocentesis: { label:'Arthrocentesis (Joint Aspiration)', category:'Invasive', indication:'Diagnostic aspiration of synovial fluid for suspected septic or inflammatory arthritis.',
      note:'Under sterile technique, the affected joint was entered via a standard approach with a syringe and needle. Synovial fluid was aspirated without complication and sent for cell count with differential, Gram stain, culture, and crystal analysis. Needle withdrawn and a pressure dressing applied.' },
    iandd: { label:'Incision & Drainage', category:'Bedside', indication:'Drainage of a soft-tissue abscess.',
      note:'The area of fluctuance was prepped in sterile fashion and infiltrated with local anesthetic. An incision was made over the point of maximal fluctuance with expression of purulent material, sent for culture. The cavity was irrigated and loosely packed. Dressing applied.' },
    intubation: { label:'Endotracheal Intubation', category:'Invasive', indication:'Airway protection / respiratory failure.',
      note:'After preoxygenation and rapid sequence induction, direct/video laryngoscopy was performed with good glottic view. An endotracheal tube was passed through the cords without difficulty and secured at the lip. End-tidal CO2 and bilateral breath sounds confirmed placement. Post-procedure chest x-ray recommended to confirm tube position.' },
    egd: { label:'Upper Endoscopy (EGD)', category:'Invasive', indication:'Evaluation of suspected upper GI bleeding.',
      note:'Upper endoscopy was performed under sedation. The esophagus, stomach, and duodenum were examined in detail. Findings and any therapeutic intervention are documented in the endoscopy report; see attending gastroenterology note for full detail.' },
    pciStent: { label:'Percutaneous Coronary Intervention (PCI) with Stent Placement', category:'Invasive', indication:'Coronary revascularization for significant coronary artery stenosis (e.g., acute coronary syndrome or symptomatic obstructive CAD).',
      note:'Coronary angiography was performed via femoral/radial access, demonstrating a significant stenosis of the target coronary artery. Percutaneous coronary intervention was performed with successful stent deployment and restoration of TIMI 3 flow. Patient tolerated the procedure well without complication; access site hemostasis achieved.' },

    telemetryStd: { label:'Continuous Cardiac Telemetry — Standard', category:'Monitoring',
      indication:'Continuous cardiac rhythm monitoring for arrhythmia detection, rate assessment, or conduction abnormality surveillance.',
      note:'MONITORING ORDER: Continuous Cardiac Telemetry\n\nINDICATION: Continuous cardiac rhythm monitoring.\n\nLEAD CONFIGURATION: 5-lead telemetry (Lead II primary; V1 for P-wave morphology and bundle-branch differentiation). Confirm lead placement and adequate signal quality at initiation.\n\nALARM PARAMETERS (default — adjust per clinical status):\n  Heart Rate High: 120 bpm\n  Heart Rate Low: 50 bpm\n  Pause threshold: ≥3.0 seconds\n  ST deviation alert: ±2.0 mm from baseline\n\nNOTIFICATION: Nursing to notify provider for sustained HR >120 or <50, new-onset atrial fibrillation or flutter, ventricular ectopy (runs of ≥3 PVCs, sustained VT), any pause ≥3 seconds, or ST changes meeting alert threshold.\n\nDURATION: Continuous until clinical team discontinues. Reassess need daily per AHA telemetry appropriateness criteria.\n\nDOCUMENTATION: Rhythm strip to be printed and placed in the chart with each nursing assessment per unit protocol.' },

    telemetryHighAcuity: { label:'Continuous Cardiac Telemetry — High Acuity (ICU/Step-Down)', category:'Monitoring',
      indication:'High-acuity continuous cardiac and hemodynamic monitoring for patients requiring intensive arrhythmia surveillance, post-cardiac procedure monitoring, or hemodynamic instability.',
      note:'MONITORING ORDER: High-Acuity Continuous Cardiac Telemetry\n\nINDICATION: High-acuity cardiac monitoring — new/recurrent life-threatening arrhythmia, hemodynamic instability, or post-procedure surveillance.\n\nLEAD CONFIGURATION: Full 5-lead continuous display (Lead II and V1 simultaneous). 12-lead acquisition capability enabled for ST-segment events.\n\nALARM PARAMETERS (tighter thresholds for high-acuity setting):\n  Heart Rate High: 100 bpm\n  Heart Rate Low: 55 bpm\n  Pause threshold: ≥2.0 seconds\n  ST deviation alert: ±1.0 mm from baseline\n  SpO2 Low: 92%\n\nNOTIFICATION: Immediate nurse bedside response for: sustained VT or VF, complete heart block, HR <40 or >150, SpO2 <90, or any ST elevation ≥1 mm in ≥2 contiguous leads. Physician notification for all critical alarms.\n\nDURATION: Continuous; reassess need every 24 hours. Downgrade to standard telemetry when appropriate.\n\nDOCUMENTATION: Rhythm strip with every vital sign set; immediate 12-lead EKG for any ST alert.' },

    telemetryPostProcedure: { label:'Post-Procedure Cardiac Monitoring (24–48 h)', category:'Monitoring',
      indication:'Cardiac rhythm monitoring following cardioversion, ablation, cardiac catheterization, pacemaker/ICD implantation, or other cardiac procedure.',
      note:'MONITORING ORDER: Post-Procedure Cardiac Telemetry\n\nINDICATION: Post-procedure cardiac rhythm surveillance.\n\nLEAD CONFIGURATION: 5-lead telemetry. Review baseline rhythm strip immediately post-procedure and document in chart.\n\nALARM PARAMETERS:\n  Heart Rate High: 110 bpm\n  Heart Rate Low: 50 bpm\n  Pause threshold: ≥2.5 seconds\n  ST deviation alert: ±1.5 mm from baseline\n\nSPECIFIC POST-PROCEDURE CONCERNS:\n  Cardioversion / ablation: monitor for recurrence of treated arrhythmia, AV block, or ST changes.\n  Cardiac catheterization: monitor access-site hemostasis and for vasovagal events.\n  Pacemaker / ICD: confirm capture (paced spikes followed by QRS), appropriate sensing, and absence of oversensing. Obtain post-implant device check per electrophysiology protocol.\n\nDURATION: Minimum 24 hours post-procedure; extend to 48 hours or until discharge if clinically indicated.\n\nDISCONTINUATION: May discontinue per attending or cardiology order once monitoring period complete and patient remains in stable rhythm.' },

    telemetryArrhythmiaRule: { label:'Telemetry — Rule Out Arrhythmia Protocol (24–48 h)', category:'Monitoring',
      indication:'Evaluation for intermittent or paroxysmal arrhythmia in a patient presenting with palpitations, presyncope, syncope, or unexplained dyspnea.',
      note:'MONITORING ORDER: Arrhythmia Rule-Out Telemetry Protocol\n\nINDICATION: Evaluation for paroxysmal arrhythmia.\n\nLEAD CONFIGURATION: 5-lead telemetry; continuous rhythm recording enabled. Activate event-capture function if available on unit telemetry system.\n\nPATIENT INSTRUCTION: Patient educated to activate event marker (nurse-call or bedside button) at onset of any palpitations, dizziness, or chest discomfort so a contemporaneous rhythm strip can be captured and correlated with symptoms.\n\nALARM PARAMETERS:\n  Heart Rate High: 150 bpm\n  Heart Rate Low: 45 bpm\n  Pause threshold: ≥2.5 seconds\n\nNOTIFICATION: Nursing to notify provider for any alarm event, sustained SVT (>30 seconds), VT, high-degree AV block, or pause. Print and save rhythm strip for all events.\n\nDURATION: 24–48 hours, or longer if paroxysmal arrhythmia not yet documented and clinical suspicion remains high. If no arrhythmia captured and symptoms do not recur, discuss outpatient ambulatory monitoring (Holter or event monitor) at discharge.\n\nDOCUMENTATION: All captured events to be reviewed by ordering provider and documented in the medical record.' },

    pulseOxContinuous: { label:'Continuous Pulse Oximetry Monitoring', category:'Monitoring',
      indication:'Continuous non-invasive oxygen saturation monitoring.',
      note:'MONITORING ORDER: Continuous Pulse Oximetry\n\nINDICATION: Continuous non-invasive SpO2 monitoring.\n\nALARM PARAMETERS:\n  SpO2 Low: 92% (adjust to 88% for documented chronic hypoxemia / COPD if ordered separately)\n  Probe-off / poor signal alert: enabled\n\nNOTIFICATION: Nursing to notify provider for SpO2 <92% on supplemental oxygen, persistent probe-off alarm, or any acute change in respiratory status.\n\nNOTE ON LIMITATIONS: Pulse oximetry does not detect hypercapnia or hypercarbia. Patients at risk for CO2 retention (COPD, obesity hypoventilation, opioid use) may require end-tidal CO2 monitoring or ABG correlation in addition to SpO2.\n\nDURATION: Continuous until discontinued by provider order.' },

    capnographyContinuous: { label:'Continuous Capnography (EtCO2) Monitoring', category:'Monitoring',
      indication:'Continuous end-tidal CO2 monitoring for patients on opioids, procedural sedation, or with risk of hypoventilation.',
      note:'MONITORING ORDER: Continuous Capnography (End-Tidal CO2)\n\nINDICATION: Continuous ventilatory monitoring to detect hypoventilation and CO2 retention.\n\nALARM PARAMETERS:\n  EtCO2 High: 50 mmHg\n  EtCO2 Low: 20 mmHg\n  Respiratory Rate Low: 8 breaths/min\n  No-breath alarm: ≥30 seconds of apnea\n\nNOTIFICATION: Immediate nursing response and provider notification for EtCO2 >50 mmHg, apnea alarm, or respiratory rate <8/min.\n\nCOMMON INDICATIONS: Post-procedure sedation recovery, patient-controlled analgesia (PCA) with opioids, obesity hypoventilation, procedural monitoring.\n\nDURATION: Continuous; reassess need every 24 hours or when clinical condition changes.' }
  };

  function buildProcedureOrderGroups(){
    const groups = {};
    const order = [];
    Object.keys(PROCEDURES).forEach(function(id){
      const p = PROCEDURES[id];
      if (!groups[p.category]){ groups[p.category]=[]; order.push(p.category); }
      groups[p.category].push({ id:id, label:p.label });
    });
    return order.map(function(cat){ return { category:cat, items:groups[cat] }; });
  }

  function buildProcedureNoteText(patient, procId, clinicianName){
    const p = PROCEDURES[procId];
    const custom = (patient.procedureNotes||{})[procId];
    const who = clinicianName || '(clinician name not entered)';
    const isMonitoring = p.category === 'Monitoring';
    let text = (isMonitoring ? 'ORDER TYPE: Continuous Monitoring\n' : 'PROCEDURE: ')+
      (isMonitoring ? '' : p.label+'\n')+
      'INDICATION: '+p.indication+'\n'+
      (isMonitoring ? '' : 'PERFORMED BY: '+who+'\n')+
      '\n'+(custom || p.note);
    if (!isMonitoring) text += '\n\nComplications: none.';
    if (procId==='lp'){
      const csf = buildCsfResultText(patient);
      text += '\n\nCSF RESULTS:\n';
      csf.lines.forEach(function(l){
        text += l.label+': '+l.value+' '+l.unit+(l.flag? ' ['+l.flag+']':'')+' (ref '+l.range+')\n';
      });
      text += 'Gram stain: '+csf.gram;
    } else if (procId==='arthrocentesis'){
      const syn = buildSynovialResultText(patient);
      text += '\n\nSYNOVIAL FLUID RESULTS:\n';
      syn.lines.forEach(function(l){
        text += l.label+': '+l.value+' '+l.unit+(l.flag? ' ['+l.flag+']':'')+' (ref '+l.range+')\n';
      });
      text += 'Gram stain: '+syn.gram+'\nCulture: pending.';
    }
    return text;
  }

  /* ---------------------------------------------------------------
     MEDICATION LIBRARY — common inpatient orders grouped by class.
     Each entry already encodes a standard dose/route/frequency so the
     dropdown catalog mirrors a realistic order set. `allergyFlag` (when
     present) is matched, case-insensitively and as a substring, against
     the patient's allergy list to generate a teaching-oriented allergy
     alert — this is NOT a real drug-interaction/allergy database.
  --------------------------------------------------------------- */
  const MEDICATIONS = {
    acetaminophen: { label:'Acetaminophen 650 mg PO q6h PRN pain/fever', category:'Analgesia', class:'Antipyretic / non-opioid analgesic', indication:'Mild pain or fever.', prn:true },
    ibuprofen: { label:'Ibuprofen 400 mg PO q6h PRN pain', category:'Analgesia', class:'NSAID', indication:'Mild-moderate pain or inflammation.', allergyFlag:'NSAID', prn:true },
    ketorolac: { label:'Ketorolac 15 mg IV q6h PRN pain (max 5 days)', category:'Analgesia', class:'NSAID', indication:'Moderate pain, short-course parenteral use.', allergyFlag:'NSAID', prn:true },
    morphine: { label:'Morphine 2–4 mg IV q3h PRN severe pain', category:'Analgesia', class:'Opioid analgesic', indication:'Moderate-severe pain.', allergyFlag:'Opioid', prn:true },
    oxycodone: { label:'Oxycodone 5 mg PO q4h PRN pain', category:'Analgesia', class:'Opioid analgesic', indication:'Moderate pain.', allergyFlag:'Opioid', prn:true },

    ceftriaxone: { label:'Ceftriaxone 1 g IV q24h', category:'Antibiotics', class:'3rd-generation cephalosporin', indication:'Empiric community-acquired / gram-negative infection coverage.', allergyFlag:'Cephalosporin' },
    cephalexin: { label:'Cephalexin 500 mg PO QID', category:'Antibiotics', class:'1st-generation cephalosporin', indication:'Mild skin/soft-tissue or urinary infection.', allergyFlag:'Cephalosporin' },
    piperacillinTazo: { label:'Piperacillin-Tazobactam 3.375 g IV q6h', category:'Antibiotics', class:'Beta-lactam / beta-lactamase inhibitor', indication:'Broad-spectrum coverage, healthcare-associated or intra-abdominal infection.', allergyFlag:'Penicillin' },
    vancomycin: { label:'Vancomycin 15–20 mg/kg IV q12h (trough-guided)', category:'Antibiotics', class:'Glycopeptide', indication:'MRSA or severe gram-positive coverage.' },
    azithromycin: { label:'Azithromycin 500 mg PO/IV daily', category:'Antibiotics', class:'Macrolide', indication:'Atypical respiratory pathogen coverage.' },
    metronidazole: { label:'Metronidazole 500 mg IV/PO q8h', category:'Antibiotics', class:'Nitroimidazole (anaerobic coverage)', indication:'Anaerobic or C. difficile coverage.' },
    sulfaTrim: { label:'Sulfamethoxazole-Trimethoprim DS 1 tab PO BID', category:'Antibiotics', class:'Sulfonamide', indication:'Uncomplicated UTI or PCP prophylaxis/treatment.', allergyFlag:'Sulfa' },

    metoprolol: { label:'Metoprolol Tartrate 25 mg PO BID', category:'Cardiovascular', class:'Beta-1 selective blocker', indication:'Rate control, hypertension, or cardioprotection.' },
    lisinopril: { label:'Lisinopril 10 mg PO daily', category:'Cardiovascular', class:'ACE inhibitor', indication:'Hypertension, heart failure with reduced EF.' },
    amlodipine: { label:'Amlodipine 5 mg PO daily', category:'Cardiovascular', class:'Dihydropyridine calcium channel blocker', indication:'Hypertension.' },
    furosemideIv: { label:'Furosemide 40 mg IV BID', category:'Cardiovascular', class:'Loop diuretic', indication:'Volume overload / decompensated heart failure.' },
    aspirin: { label:'Aspirin 81 mg PO daily', category:'Cardiovascular', class:'Antiplatelet', indication:'Cardiovascular risk reduction.' },

    heparinDrip: { label:'Heparin IV infusion per weight-based protocol', category:'Anticoagulation', class:'Unfractionated heparin', indication:'Acute VTE, ACS, or bridging anticoagulation.' },
    enoxaparinPpx: { label:'Enoxaparin 40 mg SC daily (VTE prophylaxis)', category:'Anticoagulation', class:'Low molecular weight heparin', indication:'Inpatient VTE prophylaxis.' },
    enoxaparinTx: { label:'Enoxaparin 1 mg/kg SC q12h (treatment dose)', category:'Anticoagulation', class:'Low molecular weight heparin', indication:'Treatment of acute VTE.' },
    apixaban: { label:'Apixaban 5 mg PO BID', category:'Anticoagulation', class:'Direct oral anticoagulant (factor Xa inhibitor)', indication:'Atrial fibrillation or VTE treatment.' },

    insulinSliding: { label:'Insulin Regular per sliding scale, SC before meals and at bedtime', category:'Endocrine', class:'Rapid-acting insulin', indication:'Inpatient glycemic control.' },
    insulinGlargine: { label:'Insulin Glargine 20 units SC at bedtime', category:'Endocrine', class:'Long-acting insulin', indication:'Basal glycemic control.' },
    levothyroxine: { label:'Levothyroxine 75 mcg PO daily (empty stomach)', category:'Endocrine', class:'Thyroid hormone replacement', indication:'Hypothyroidism.' },

    pantoprazole: { label:'Pantoprazole 40 mg IV/PO daily', category:'Gastrointestinal', class:'Proton pump inhibitor', indication:'GI bleed / stress ulcer prophylaxis / GERD.' },
    ondansetron: { label:'Ondansetron 4 mg IV q6h PRN nausea', category:'Gastrointestinal', class:'5-HT3 antagonist (antiemetic)', indication:'Nausea/vomiting.', prn:true },
    lactulose: { label:'Lactulose 30 mL PO TID, titrate to 3 soft stools/day', category:'Gastrointestinal', class:'Osmotic laxative', indication:'Hepatic encephalopathy / constipation.' },

    albuterolNeb: { label:'Albuterol 2.5 mg nebulized q4h PRN wheeze/dyspnea', category:'Respiratory', class:'Short-acting beta-2 agonist', indication:'Bronchospasm.', prn:true },
    ipratropiumNeb: { label:'Ipratropium 0.5 mg nebulized q6h', category:'Respiratory', class:'Anticholinergic bronchodilator', indication:'COPD exacerbation.' },
    prednisone: { label:'Prednisone 40 mg PO daily x5 days', category:'Respiratory', class:'Corticosteroid', indication:'COPD or asthma exacerbation.' },

    nsBolus: { label:'Normal Saline 1 L IV bolus', category:'IV Fluids & Electrolytes', class:'Isotonic crystalloid', indication:'Volume resuscitation.' },
    nsMaintenance: { label:'0.9% Sodium Chloride IV at 100 mL/hr (maintenance)', category:'IV Fluids & Electrolytes', class:'Isotonic crystalloid', indication:'Maintenance fluids / NPO status.' },
    potassiumReplete: { label:'Potassium Chloride 20 mEq PO/IV once (repletion)', category:'IV Fluids & Electrolytes', class:'Electrolyte replacement', indication:'Hypokalemia.' },
    magnesiumReplete: { label:'Magnesium Sulfate 2 g IV once (repletion)', category:'IV Fluids & Electrolytes', class:'Electrolyte replacement', indication:'Hypomagnesemia.' },

    lorazepam: { label:'Lorazepam 1 mg IV/PO q6h PRN anxiety/agitation', category:'Psychiatric / Sedation', class:'Benzodiazepine', indication:'Anxiety, agitation, alcohol withdrawal.', prn:true },
    haloperidol: { label:'Haloperidol 2 mg IV/IM/PO q6h PRN agitation', category:'Psychiatric / Sedation', class:'Typical antipsychotic', indication:'Acute agitation/delirium.', prn:true }
  };

  function buildMedicationOrderGroups(){
    const groups = {};
    const order = [];
    Object.keys(MEDICATIONS).forEach(function(id){
      const m = MEDICATIONS[id];
      if (!groups[m.category]){ groups[m.category]=[]; order.push(m.category); }
      groups[m.category].push({ id:id, label:m.label });
    });
    return order.map(function(cat){ return { category:cat, items:groups[cat] }; });
  }

  /* ---------------------------------------------------------------
     DIET ORDER LIBRARY — common inpatient diet and nutrition orders.
     These are placed as their own order category ('diet') and are
     displayed on the Medications tab alongside active drug orders.
  --------------------------------------------------------------- */
  const DIET_ORDERS = {
    npo:        { label:'NPO (nothing by mouth)', category:'Diet & Nutrition', note:'Patient is NPO. Ensure IV access is maintained for medications and fluids.' },
    npoMidnight:{ label:'NPO after midnight', category:'Diet & Nutrition', note:'Patient may have oral intake until midnight; NPO thereafter. Typically ordered before procedures or surgeries.' },
    clearLiquid:{ label:'Clear liquid diet', category:'Diet & Nutrition', note:'Clear liquids only: water, broth, gelatin, apple juice, tea/coffee without milk. No solid food.' },
    fullLiquid: { label:'Full liquid diet', category:'Diet & Nutrition', note:'All liquids including dairy, smooth soups, juice, ice cream. Used as step-up from clear liquids or post-procedure.' },
    softMech:   { label:'Soft / mechanical soft diet', category:'Diet & Nutrition', note:'Soft, easy-to-chew foods. Appropriate for dysphagia or post-oral/dental procedures.' },
    cardiac:    { label:'Cardiac diet (low saturated fat, low cholesterol)', category:'Diet & Nutrition', note:'Reduced saturated fat (<7% of calories), low cholesterol (<200 mg/day), emphasis on fruits, vegetables, and whole grains.' },
    lowSodium:  { label:'Low-sodium diet (2 g sodium/day)', category:'Diet & Nutrition', note:'Sodium restriction to 2 g/day. Indicated for hypertension, heart failure, cirrhosis with ascites, and chronic kidney disease.' },
    diabetic:   { label:'Consistent carbohydrate diet (diabetic, 45 g CHO per meal)', category:'Diet & Nutrition', note:'Carbohydrate-controlled diet with consistent CHO intake at each meal. Supports glycemic management in type 1 and type 2 diabetes.' },
    renalDiet:  { label:'Renal diet (low potassium, low phosphorus, fluid restriction)', category:'Diet & Nutrition', note:'Restricts potassium, phosphorus, and sodium; may include fluid restriction depending on dialysis status and residual renal function.' },
    lowFat:     { label:'Low-fat diet (<30% calories from fat)', category:'Diet & Nutrition', note:'Indicated for pancreatitis, cholecystitis, and malabsorption syndromes.' },
    lowFiber:   { label:'Low-fiber / low-residue diet', category:'Diet & Nutrition', note:'Minimizes undigested material in the colon. Used for IBD flares, bowel obstruction, or pre-colonoscopy bowel rest.' },
    highFiber:  { label:'High-fiber diet (>25 g fiber/day)', category:'Diet & Nutrition', note:'Encouraged for constipation, hyperlipidemia, and type 2 diabetes.' },
    regularDiet:{ label:'Regular diet (no restrictions)', category:'Diet & Nutrition', note:'No dietary restrictions. Patient may eat from the general hospital menu.' },
    tupFeeds:   { label:'Tube feeds — per nutrition consult', category:'Enteral / Parenteral Nutrition', note:'Initiate enteral nutrition per registered dietitian / nutrition team recommendations. Document tube type and position verification.' },
    tpn:        { label:'Total Parenteral Nutrition (TPN) — per nutrition consult', category:'Enteral / Parenteral Nutrition', note:'Initiate TPN per nutrition consult. Requires central venous access. Monitor glucose, electrolytes, and liver function.' },
    nutritionConsult:{ label:'Nutrition consult', category:'Enteral / Parenteral Nutrition', note:'Referral placed to registered dietitian for formal nutritional assessment and diet recommendations.' }
  };

  function buildDietOrderGroups(){
    const groups = {}, order = [];
    Object.keys(DIET_ORDERS).forEach(function(id){
      const d = DIET_ORDERS[id];
      if (!groups[d.category]){ groups[d.category]=[]; order.push(d.category); }
      groups[d.category].push({ id:id, label:d.label });
    });
    return order.map(function(cat){ return { category:cat, items:groups[cat] }; });
  }

  function buildDietOrderText(dietId, clinicianName){
    const d = DIET_ORDERS[dietId];
    const who = clinicianName || '(ordering provider not specified)';
    return 'DIET ORDER: '+d.label+'\nORDERING PROVIDER: '+who+'\n\n'+d.note;
  }

  function patientHasAllergyMatch(patient, needle){
    if (!needle) return false;
    const list = (patient.allergies||[]).filter(function(a){ return a!=='NKDA'; });
    const n = needle.toLowerCase();
    return list.some(function(a){
      const al = a.toLowerCase();
      return al.indexOf(n)>-1 || n.indexOf(al)>-1;
    });
  }

  function buildMedicationOrderText(patient, medId, clinicianName){
    const m = MEDICATIONS[medId];
    const who = clinicianName || '(ordering provider not specified)';
    const allergyHit = patientHasAllergyMatch(patient, m.allergyFlag);
    let text = 'ORDER: '+m.label+'\nCLASS: '+m.class+'\nINDICATION: '+(m.indication||'—')+'\nORDERING PROVIDER: '+who+'\n\n';
    if (allergyHit){
      text += '\u26A0 ALLERGY ALERT: This order falls in a class ('+m.allergyFlag+') that may conflict with this patient\u2019s documented allergies ('+patient.allergies.join(', ')+'). Verify before administration.\n\n';
    }
    text += 'Order reviewed and verified by pharmacy. '+(m.prn ? 'Available for administration per the PRN parameters above.' : 'Added to the active medication administration record (MAR).');
    return { text: text, critical: allergyHit };
  }

  function buildCustomMedicationOrderText(patient, medData, clinicianName){
    const who = clinicianName || '(ordering provider not specified)';
    const allergyHit = patientHasAllergyMatch(patient, medData.drug);
    let text = 'ORDER (custom-entered): '+medData.label+'\nORDERING PROVIDER: '+who+'\n\n';
    if (allergyHit){
      text += '\u26A0 ALLERGY ALERT: Compare this medication name against the patient\u2019s documented allergies ('+patient.allergies.join(', ')+') before administration.\n\n';
    }
    text += 'Order reviewed and verified by pharmacy. '+(medData.prn ? 'Available for administration per the PRN parameters above.' : 'Added to the active medication administration record (MAR).');
    return { text: text, critical: allergyHit };
  }

  /* ---------------------------------------------------------------
     PATIENT PANEL — 20 fictional inpatient cases spanning core PA
     rotation content. Every value here is invented for teaching
     purposes. Admission dates are computed relative to "today" so
     the board always looks current.
  --------------------------------------------------------------- */
  function daysAgo(n){ return Date.now() - n*86400000; }
  /* ---------------------------------------------------------------
     PATIENT DATA LOADING
     The built-in roster used to be a giant literal assigned directly
     to PATIENTS here. It now lives in patientData.json so non-JS
     users (and version control) can read/edit it on its own. Because
     JSON can't hold a function call, each patient's admitAt —
     originally daysAgo(N) — is stored as {"__daysAgoOffset__": N}
     and resolved back into a real timestamp by resolvePatientDates()
     below, exactly reproducing the original "N days before whenever
     the page happens to load" behavior (never a frozen calendar date).

     PATIENTS_FALLBACK is the exact original array literal, byte-for-byte,
     kept here so the simulator still works if this file is opened
     directly as file:// with no local server — browsers block fetch()
     of local JSON files under file://, so patientData.json would
     otherwise silently fail to load. If you edit the patient roster,
     keep patientData.json and PATIENTS_FALLBACK in sync; only
     patientData.json needs the {"__daysAgoOffset__": N} form —
     PATIENTS_FALLBACK uses real daysAgo(N) calls since it's plain JS. */
  let PATIENTS = [];

  const PATIENTS_FALLBACK = [
  { id:'p01', last:'Whitfield', first:'Eleanor', mrn:'TR-100234', dob:'1948-03-22', sex:'F', room:'4102',
    admitAt:daysAgo(2), attending:'Dr. Patricia Alvarez', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Worsening shortness of breath and leg swelling x5 days',
    allergies:['NKDA'], problemList:['HFrEF (EF ~30%)','Paroxysmal atrial fibrillation','Hypertension','CKD stage 3'],
    homeMeds:['Furosemide 40 mg PO daily','Metoprolol succinate 50 mg PO daily','Lisinopril 10 mg PO daily','Apixaban 5 mg PO BID'],
    vitals:{temp:98.2,hr:96,bp:'148/88',rr:24,spo2:91,pain:1},
    labProfile:{bnp:1450, na:129, cr:1.5, bun:32, troponin:0.06, wbc:8.1},
    imagingFindings:{ cxr:{findings:'Cardiomegaly with bilateral perihilar haziness, interstitial edema, and small bilateral pleural effusions.', impression:'Findings consistent with acute pulmonary edema / decompensated heart failure.'},
      tte:{findings:'Left ventricle is moderately to severely dilated with an estimated ejection fraction of 30%. Global hypokinesis. Mild functional mitral regurgitation.', impression:'Reduced left ventricular ejection fraction (~30%), unchanged from a prior study.'} },
    seedHP:{ cc:'Worsening dyspnea and bilateral leg swelling for 5 days.',
      hpi:'78-year-old woman with HFrEF (EF 30%), atrial fibrillation, and hypertension presents with progressive dyspnea on exertion, orthopnea, and bilateral lower-extremity edema over 5 days. Reports missing several furosemide doses and a high-sodium meal at a family gathering. Denies chest pain, fever, or cough.',
      pmh:'HFrEF (EF 30%); paroxysmal atrial fibrillation on apixaban; hypertension; CKD stage 3 (baseline Cr ~1.3).',
      psh:'Cholecystectomy (2005).',
      meds:'Furosemide 40 mg daily; metoprolol succinate 50 mg daily; lisinopril 10 mg daily; apixaban 5 mg BID.',
      allergies:'NKDA.', fhx:'Father — MI at age 70. Mother — hypertension.',
      shx:'Lives with spouse, independent with ADLs. Former smoker, quit 20 years ago (30 pack-year history). No alcohol or illicit drug use.',
      ros:'Positive for dyspnea, orthopnea, leg swelling, ~4 lb weight gain. Negative for chest pain, fever, cough, or palpitations.',
      pe:'SpO2 91% RA, improved to 95% on 2L NC. JVD to the angle of the jaw. Bibasilar crackles halfway up posteriorly. Irregularly irregular rhythm, no murmur. 2+ pitting edema to the knees bilaterally. Abdomen soft, nontender.',
      studies:'BNP 1450, Na 129, Cr 1.5 (baseline 1.3), troponin 0.06 (flat on trend). CXR with pulmonary edema and small effusions. TTE with EF ~30%, unchanged from prior.',
      assessment:'1) Acute decompensated HFrEF, likely dietary indiscretion and medication nonadherence. 2) Hyponatremia, dilutional/hypervolemic. 3) Acute-on-chronic kidney disease, likely cardiorenal. 4) Paroxysmal AF, rate-controlled, anticoagulated.',
      plan:'1) IV diuresis with strict I/Os and daily weights, transition to oral once euvolemic. 2) Sodium/fluid restriction. 3) Daily BMP; hold lisinopril while creatinine elevated. 4) Continue metoprolol and apixaban. 5) Telemetry. 6) Cardiology following. 7) Heart-failure self-management education before discharge.' } },

  { id:'p02', last:'Boykin', first:'Harold', mrn:'TR-100241', dob:'1960-07-09', sex:'M', room:'4104',
    admitAt:daysAgo(1), attending:'Dr. Marcus Ihejirika', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Increased shortness of breath and productive cough x3 days',
    allergies:['NKDA'], problemList:['COPD (GOLD stage III)','Hypertension','20 pack-year former smoker'],
    homeMeds:['Tiotropium inhaler daily','Albuterol/ipratropium nebulizer PRN','Amlodipine 5 mg PO daily'],
    vitals:{temp:99.1,hr:104,bp:'138/84',rr:26,spo2:88,pain:0},
    labProfile:{wbc:11.8, ph:7.32, pco2:58, po2:68, hco3:30},
    imagingFindings:{ cxr:{findings:'Hyperinflated lungs with flattened diaphragms and increased retrosternal air space. No focal consolidation or effusion.', impression:'Findings consistent with COPD; no acute infiltrate.'} },
    seedHP:{ cc:'Increased dyspnea, cough, and sputum production for 3 days.',
      hpi:'66-year-old man with severe COPD presents with a 3-day increase in dyspnea, cough, and thicker/darker sputum, similar to prior exacerbations. Using rescue inhaler every 2 hours without relief. No fever, chest pain, or hemoptysis. No sick contacts.',
      pmh:'COPD GOLD stage III (baseline home O2 not required); hypertension.', psh:'None.',
      meds:'Tiotropium daily; albuterol/ipratropium nebulizer PRN; amlodipine 5 mg daily.',
      allergies:'NKDA.', fhx:'Father died of lung cancer.', shx:'40 pack-year smoking history, quit 5 years ago. Works as a retired machinist. Denies alcohol/drug use.',
      ros:'Positive for dyspnea, cough, increased sputum. Negative for fever, chest pain, hemoptysis, leg swelling.',
      pe:'Using accessory muscles of respiration, speaking in short sentences. Diffuse expiratory wheezes and prolonged expiratory phase bilaterally. No focal crackles. No peripheral edema.',
      studies:'ABG: pH 7.32, pCO2 58, pO2 68 on room air, HCO3 30 (chronic compensation with acute worsening). WBC mildly elevated at 11.8. CXR with hyperinflation, no infiltrate.',
      assessment:'1) Acute COPD exacerbation with acute-on-chronic hypercapnic respiratory failure. 2) Hypertension, stable.',
      plan:'1) Supplemental O2 titrated to SpO2 88–92%. 2) Scheduled nebulized albuterol/ipratropium. 3) Systemic corticosteroids (prednisone taper). 4) Empiric azithromycin given change in sputum character. 5) Repeat ABG after initial treatment; consider BiPAP if worsening. 6) Continue home antihypertensive. 7) Smoking-cessation counseling reinforced, pulmonary rehab referral at discharge.' } },

  { id:'p03', last:'Ferreira', first:'Marisol', mrn:'TR-100255', dob:'1972-11-02', sex:'F', room:'4108',
    admitAt:daysAgo(1), attending:'Dr. Patricia Alvarez', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Fever, productive cough, and pleuritic chest pain x4 days',
    allergies:['Sulfa — hives'], problemList:['Type 2 diabetes mellitus','Obesity'],
    homeMeds:['Metformin 1000 mg PO BID','Empagliflozin 10 mg PO daily'],
    vitals:{temp:102.4,hr:112,bp:'104/68',rr:24,spo2:90,pain:5},
    labProfile:{wbc:15.4, lactate:1.8, glu:188},
    labTextProfile:{ bloodcx:'Pending — no growth to date on either bottle set. Final results in 5 days if no growth.' },
    imagingFindings:{ cxr:{findings:'Dense right lower lobe consolidation with air bronchograms. No effusion.', impression:'Right lower lobe pneumonia.'} },
    seedHP:{ cc:'Fever, cough, and right-sided pleuritic chest pain for 4 days.',
      hpi:'54-year-old woman with type 2 diabetes presents with 4 days of fever, productive cough with rust-colored sputum, and right-sided pleuritic chest pain, now with worsening dyspnea. No recent travel or sick contacts.',
      pmh:'Type 2 diabetes mellitus; obesity.', psh:'C-section x2.',
      meds:'Metformin 1000 mg BID; empagliflozin 10 mg daily.', allergies:'Sulfa drugs — hives.',
      fhx:'Mother — type 2 diabetes.', shx:'Works as a school administrator, lives with family. Never smoker, occasional alcohol use.',
      ros:'Positive for fever, chills, productive cough, pleuritic chest pain, dyspnea. Negative for hemoptysis, leg swelling, sick contacts.',
      pe:'Febrile to 102.4F, tachycardic, tachypneic, SpO2 90% RA. Dullness to percussion and bronchial breath sounds with crackles at the right base. No accessory muscle use at rest.',
      studies:'WBC 15.4 with left shift. Lactate mildly elevated at 1.8. CXR with right lower lobe consolidation. Blood cultures pending.',
      assessment:'1) Community-acquired pneumonia, right lower lobe, moderate severity. 2) Type 2 diabetes, hyperglycemic in the setting of acute illness.',
      plan:'1) Empiric ceftriaxone plus azithromycin (avoiding sulfa-based agents given allergy); narrow per culture data. 2) Supplemental O2 to maintain SpO2 >92%. 3) IV fluids as needed. 4) Continue home metformin/empagliflozin once tolerating oral intake and renal function confirmed stable; hold if hypoxic/hypotensive per SGLT2 sick-day guidance. 5) Blood cultures and sputum culture pending, trend WBC/lactate. 6) Incentive spirometry, early mobilization.' } },

  { id:'p04', last:'Brooks', first:'Tyler', mrn:'TR-100262', dob:'2004-01-30', sex:'M', room:'4210',
    admitAt:daysAgo(1), attending:'Dr. Samuel Okafor', team:'Surgery', codeStatus:'Full Code',
    chiefComplaint:'Periumbilical pain migrating to the right lower quadrant x1 day',
    allergies:['NKDA'], problemList:[], homeMeds:[],
    vitals:{temp:100.6,hr:98,bp:'126/78',rr:18,spo2:98,pain:7},
    labProfile:{wbc:13.9},
    imagingFindings:{ ctAbdPelvis:{findings:'The appendix is dilated to 11 mm with wall thickening, surrounding fat stranding, and a small appendicolith at its base. No free air or drainable abscess.', impression:'Findings consistent with acute appendicitis.'} },
    seedHP:{ cc:'Abdominal pain migrating to the right lower quadrant, 1 day.',
      hpi:'22-year-old man presents with 24 hours of periumbilical pain that migrated to the right lower quadrant, associated with anorexia, nausea, and one episode of emesis. Denies diarrhea, dysuria, or fever until this morning.',
      pmh:'None.', psh:'None.', meds:'None.', allergies:'NKDA.', fhx:'Noncontributory.',
      shx:'College student, lives in a dorm. No tobacco, occasional alcohol, no illicit drug use.',
      ros:'Positive for abdominal pain, anorexia, nausea, subjective fever. Negative for diarrhea, dysuria, hematuria.',
      pe:'Low-grade fever. Abdomen with focal tenderness and guarding at McBurney point, positive rebound tenderness, positive psoas sign. No peritonitis. Normal external genitalia exam, no hernia.',
      studies:'WBC 13.9 with neutrophil predominance. CT abdomen/pelvis with dilated, thickened appendix and appendicolith, consistent with acute appendicitis.',
      assessment:'1) Acute, uncomplicated appendicitis.',
      plan:'1) NPO, IV fluids. 2) Preoperative antibiotics (ceftriaxone/metronidazole). 3) Consent for laparoscopic appendectomy, surgery to proceed today. 4) Analgesia and antiemetics as needed. 5) Postoperative diet advancement and discharge planning once tolerating oral intake with adequate pain control.' } },

  { id:'p05', last:'Nguyen', first:'Ashley', mrn:'TR-100270', dob:'2007-05-14', sex:'F', room:'4212',
    admitAt:daysAgo(1), attending:'Dr. Marcus Ihejirika', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Nausea, vomiting, and abdominal pain x2 days with known type 1 diabetes',
    allergies:['NKDA'], problemList:['Type 1 diabetes mellitus'],
    homeMeds:['Insulin glargine 18 units nightly','Insulin lispro sliding scale with meals'],
    vitals:{temp:99.0,hr:118,bp:'102/64',rr:26,spo2:97,pain:6},
    labProfile:{glu:512, k:5.6, hco3:11, ph:7.18, pco2:22, na:133, uasg:1.030, uaketones:4, uaglucose:5, uablood:0, uaprotein:0, ualeukest:0, uanitrites:0},
    seedHP:{ cc:'Nausea, vomiting, and diffuse abdominal pain for 2 days.',
      hpi:'19-year-old woman with type 1 diabetes presents with 2 days of nausea, vomiting, and diffuse abdominal pain. Ran out of insulin glargine 3 days ago and has not been able to refill it. Reports polyuria and polydipsia. No fever, diarrhea, or sick contacts.',
      pmh:'Type 1 diabetes mellitus, diagnosed age 12.', psh:'None.',
      meds:'Insulin glargine 18 units nightly (lapsed x3 days); insulin lispro sliding scale.', allergies:'NKDA.',
      fhx:'Mother — type 1 diabetes.', shx:'College student, lives with roommates. No tobacco, alcohol, or illicit drug use.',
      ros:'Positive for polyuria, polydipsia, nausea, vomiting, abdominal pain, fatigue. Negative for fever, diarrhea, dysuria.',
      pe:'Tachycardic, tachypneic with deep Kussmaul respirations, fruity breath odor. Mucous membranes dry. Diffuse mild abdominal tenderness without rebound or guarding. Alert and oriented x4.',
      studies:'Glucose 512, K 5.6, HCO3 11, VBG pH 7.18/pCO2 22 (with anion gap markedly elevated). UA with large ketones and glucosuria.',
      assessment:'1) Diabetic ketoacidosis, precipitated by insulin nonadherence (lapsed prescription). 2) Type 1 diabetes mellitus.',
      plan:'1) IV isotonic fluids per DKA protocol. 2) IV insulin infusion with hourly glucose checks and q2-4h BMP until anion gap closes. 3) Potassium repletion once K trends toward normal range with insulin therapy; monitor closely given initial hyperkalemia from acidosis/insulin deficiency. 4) Transition to subcutaneous insulin once anion gap closed and tolerating oral intake, with overlap dosing. 5) Diabetes education and prescription-access/social work referral prior to discharge to prevent recurrence. 6) Monitor for cerebral edema symptoms given age.' } },

  { id:'p06', last:'Ruiz', first:'Constance', mrn:'TR-100281', dob:'1953-09-18', sex:'F', room:'4110',
    admitAt:daysAgo(2), attending:'Dr. Patricia Alvarez', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Fever, chills, and flank pain x2 days',
    allergies:['NKDA'], problemList:['Hypertension','Baseline CKD stage 2'],
    homeMeds:['Amlodipine 10 mg PO daily'],
    vitals:{temp:102.9,hr:114,bp:'96/58',rr:22,spo2:96,pain:6},
    labProfile:{wbc:16.2, cr:1.4, lactate:2.4, uacolor:2, uaclarity:2, ualeukest:3, uanitrites:1, uawbc:100, uarbc:3, uabacteria:2},
    labTextProfile:{ urinecx:'Preliminary at 24h: >100,000 CFU/mL Gram-negative rods, growth consistent with E. coli; final identification and sensitivities pending.',
      bloodcx:'Preliminary at 12h: Gram-negative rods in 2 of 2 bottle sets, pending final speciation and sensitivities.' },
    imagingFindings:{ ctAbdPelvis:{findings:'Mild right-sided hydronephrosis with perinephric fat stranding. No discrete renal or perinephric abscess. No obstructing calculus identified.', impression:'Findings consistent with acute pyelonephritis; no abscess or obstructing stone.'} },
    seedHP:{ cc:'Fever, chills, and right flank pain for 2 days.',
      hpi:'71-year-old woman presents with 2 days of fever, rigors, right flank pain, and dysuria. Now with lightheadedness and decreased oral intake. No prior similar episodes.',
      pmh:'Hypertension; CKD stage 2 (baseline Cr ~1.1).', psh:'Total abdominal hysterectomy.',
      meds:'Amlodipine 10 mg daily.', allergies:'NKDA.', fhx:'Noncontributory.',
      shx:'Lives alone, independent with ADLs. Never smoker, no alcohol use.',
      ros:'Positive for fever, chills, flank pain, dysuria, urinary frequency. Negative for vaginal discharge, hematuria, abdominal pain.',
      pe:'Febrile, tachycardic, hypotensive to 96/58. Right costovertebral angle tenderness. Abdomen soft, mild suprapubic tenderness. No peritoneal signs.',
      studies:'WBC 16.2, creatinine 1.4 (above baseline), lactate 2.4. UA grossly infected. CT abdomen/pelvis with right hydronephrosis and perinephric stranding, no abscess. Urine and blood cultures pending, preliminary growth of Gram-negative rods.',
      assessment:'1) Acute pyelonephritis with sepsis (SIRS criteria met, likely urinary source). 2) Acute kidney injury, likely pre-renal/septic. 3) Hypertension.',
      plan:'1) IV isotonic fluid resuscitation. 2) Empiric IV ceftriaxone, narrow once culture/sensitivities finalize. 3) Serial lactate and vitals to assess response, escalate to ICU if hemodynamic instability persists. 4) Trend renal function; hold amlodipine while hypotensive. 5) Repeat imaging if not clinically improving to rule out abscess. 6) Urology referral if obstruction develops.' } },

  { id:'p07', last:'Delgado', first:'Rosa', mrn:'TR-100290', dob:'1980-02-11', sex:'F', room:'4214',
    admitAt:daysAgo(1), attending:'Dr. Samuel Okafor', team:'Surgery', codeStatus:'Full Code',
    chiefComplaint:'Right upper quadrant abdominal pain after meals x2 days, worse today',
    allergies:['NKDA'], problemList:['Obesity'], homeMeds:[],
    vitals:{temp:100.8,hr:102,bp:'132/80',rr:18,spo2:98,pain:7},
    labProfile:{wbc:12.5, alkphos:165, tbili:1.4, ast:58, alt:64},
    imagingFindings:{ usRuq:{findings:'Gallbladder wall is thickened to 5 mm with pericholecystic fluid and multiple mobile echogenic gallstones. Sonographic Murphy sign positive. Common bile duct is normal in caliber at 4 mm.', impression:'Findings consistent with acute cholecystitis; no evidence of choledocholithiasis.'} },
    seedHP:{ cc:'Right upper quadrant pain, worsening over 2 days.',
      hpi:'45-year-old woman with a history of recurrent postprandial right upper quadrant pain presents with 2 days of constant, worsening right upper quadrant pain radiating to the right shoulder blade, now with fever and one episode of vomiting. Pain no longer resolves as it has in the past.',
      pmh:'Obesity; recurrent biliary colic (not previously worked up).', psh:'None.', meds:'None.', allergies:'NKDA.',
      fhx:'Mother — gallstones, cholecystectomy.', shx:'Works as a nurse. No tobacco, occasional alcohol use.',
      ros:'Positive for right upper quadrant pain, fever, nausea, vomiting. Negative for jaundice, dark urine, pale stools, diarrhea.',
      pe:'Low-grade fever, tachycardic. Right upper quadrant tenderness with a positive Murphy sign, voluntary guarding. No jaundice. No palpable mass.',
      studies:'WBC 12.5, mild transaminitis, alkaline phosphatase 165, total bilirubin 1.4. RUQ ultrasound with gallbladder wall thickening, pericholecystic fluid, and stones; positive sonographic Murphy sign; no CBD dilation.',
      assessment:'1) Acute cholecystitis. 2) Mild transaminitis, likely reactive to acute cholecystitis rather than choledocholithiasis given normal CBD caliber.',
      plan:'1) NPO, IV fluids, analgesia, and antiemetics. 2) IV antibiotics (ceftriaxone/metronidazole). 3) Surgery consulted for laparoscopic cholecystectomy, likely within 24–72 hours. 4) Trend liver enzymes and bilirubin; repeat imaging/MRCP if rising or CBD dilation develops. 5) Postoperative diet advancement and discharge planning.' } },

  { id:'p08', last:'Simmons', first:'Walter', mrn:'TR-100305', dob:'1965-06-27', sex:'M', room:'4118',
    admitAt:daysAgo(1), attending:'Dr. Patricia Alvarez', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Vomiting blood x1 episode this morning',
    allergies:['NKDA'], problemList:['Cirrhosis (alcohol-associated)','Esophageal varices (known, prior banding)'],
    homeMeds:['Propranolol 20 mg PO BID','Spironolactone 100 mg PO daily','Lactulose 30 mL PO TID'],
    vitals:{temp:98.4,hr:110,bp:'92/58',rr:20,spo2:97,pain:2},
    labProfile:{hgb:7.8, plt:88, inr:1.6, albumin:2.6, tbili:2.8, ast:96, alt:58, bun:28},
    procedureNotes:{ egd:'Upper endoscopy revealed grade II esophageal varices in the distal esophagus with stigmata of recent bleeding (adherent clot); no active spurting at the time of exam. Endoscopic band ligation was performed on 4 varices with good hemostasis. Stomach and duodenum were otherwise unremarkable.' },
    seedHP:{ cc:'One episode of hematemesis this morning.',
      hpi:'61-year-old man with known alcohol-associated cirrhosis and prior variceal banding presents after one large-volume episode of bright red hematemesis this morning, associated with lightheadedness. Reports 2 days of dark, tarry stools preceding this episode. Denies recent NSAID use; admits to ongoing alcohol use.',
      pmh:'Cirrhosis (alcohol-associated), Child-Pugh class B; known esophageal varices, prior banding 1 year ago; ascites (intermittent).', psh:'None.',
      meds:'Propranolol 20 mg BID; spironolactone 100 mg daily; lactulose 30 mL TID.', allergies:'NKDA.',
      fhx:'Noncontributory.', shx:'Ongoing heavy alcohol use (~6 drinks/day); denies illicit drug use; former smoker.',
      ros:'Positive for hematemesis, melena, lightheadedness. Negative for abdominal pain, fever.',
      pe:'Tachycardic, borderline hypotensive, orthostatic. Scleral icterus. Spider angiomata on chest. Abdomen mildly distended with shifting dullness, nontender. No asterixis. Guaiac-positive dark stool on rectal exam.',
      studies:'Hgb 7.8 (down from a prior baseline ~11), platelets 88, INR 1.6, albumin 2.6, total bilirubin 2.8, transaminases mildly elevated. Type & screen sent.',
      assessment:'1) Upper gastrointestinal bleeding, most consistent with variceal hemorrhage given known cirrhosis and varices. 2) Cirrhosis with portal hypertension, decompensated (variceal bleed). 3) Coagulopathy of liver disease.',
      plan:'1) Two large-bore IVs, type & crossmatch, transfuse packed red cells to a goal Hgb ~7–8. 2) IV octreotide infusion and IV ceftriaxone for SBP prophylaxis. 3) Urgent GI consultation for EGD with likely band ligation. 4) Correct coagulopathy per GI/hepatology recommendation. 5) Continue lactulose, monitor for hepatic encephalopathy. 6) Alcohol use counseling and social work involvement; consider addiction medicine consult.' } },

  { id:'p09', last:'Oduya', first:'James', mrn:'TR-100311', dob:'1956-12-05', sex:'M', room:'4220',
    admitAt:daysAgo(1), attending:'Dr. Renata Kowalski', team:'Neurology', codeStatus:'Full Code',
    chiefComplaint:'Sudden right-sided weakness and slurred speech, onset 2 hours ago',
    allergies:['NKDA'], problemList:['Hypertension','Hyperlipidemia'],
    homeMeds:['Amlodipine 5 mg PO daily','Atorvastatin 40 mg PO daily'],
    vitals:{temp:98.6,hr:88,bp:'176/98',rr:16,spo2:97,pain:0},
    labProfile:{hba1c:6.8, glu:110},
    imagingFindings:{ ctHead:{findings:'No acute hemorrhage. Subtle loss of gray-white differentiation and effacement of sulci in the left MCA territory, without established infarct or mass effect.', impression:'Subtle early ischemic changes in the left MCA territory; no hemorrhage. Findings are consistent with hyperacute ischemic stroke — clinical correlation and follow-up imaging recommended.'} },
    seedHP:{ cc:'Sudden right-sided weakness and slurred speech, onset 2 hours prior to arrival.',
      hpi:'70-year-old man with hypertension and hyperlipidemia was last known well 2 hours prior to arrival, then found by his spouse with right facial droop, right arm and leg weakness, and slurred speech. No witnessed trauma or seizure activity. Brought in immediately by EMS; within the thrombolytic window on arrival.',
      pmh:'Hypertension; hyperlipidemia.', psh:'None.', meds:'Amlodipine 5 mg daily; atorvastatin 40 mg daily.', allergies:'NKDA.',
      fhx:'Father — stroke at age 75.', shx:'Retired, lives with spouse. Former smoker (quit 15 years ago), occasional alcohol use.',
      ros:'Unable to fully assess given expressive difficulty; positive for weakness and speech change per collateral history. Negative for headache, seizure, trauma per bystander report.',
      pe:'NIHSS assessed at bedside: right facial droop, right arm drift, right leg drift, dysarthria, mild expressive aphasia (composite score in the moderate range). Pupils equal and reactive. No neglect.',
      studies:'Glucose 110, HbA1c 6.8 (previously undiagnosed prediabetes/early diabetes). CT head without acute hemorrhage; subtle early ischemic changes in the left MCA territory.',
      assessment:'1) Acute ischemic stroke, left MCA territory, within the thrombolytic and thrombectomy window. 2) Hypertension, permissively elevated in the acute stroke setting. 3) Newly identified impaired glucose tolerance (HbA1c 6.8).',
      plan:'1) IV thrombolysis per protocol given time-of-onset and imaging eligibility, after confirming no contraindications. 2) CT angiogram to assess for large-vessel occlusion and thrombectomy candidacy. 3) Permissive hypertension per acute stroke parameters; avoid aggressive BP lowering acutely. 4) Neuro checks and NIHSS q1h initially. 5) Swallow evaluation before oral intake. 6) Start statin/antiplatelet per neurology once post-tPA window has passed; outpatient diabetes workup.' } },

  { id:'p10', last:'Park', first:'Linda', mrn:'TR-100322', dob:'1968-04-19', sex:'F', room:'4106',
    admitAt:daysAgo(1), attending:'Dr. Marcus Ihejirika', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Substernal chest pressure x3 hours, radiating to the left arm',
    allergies:['NKDA'], problemList:['Hyperlipidemia','Type 2 diabetes mellitus'],
    homeMeds:['Metformin 1000 mg PO BID','Rosuvastatin 20 mg PO daily'],
    vitals:{temp:98.0,hr:92,bp:'146/90',rr:18,spo2:97,pain:6},
    labProfile:{troponin:0.85, bnp:210, ldl:142, hdl:38, tg:210},
    imagingFindings:{ ekg:{findings:'Normal sinus rhythm. T-wave inversions in leads V2–V4, no ST-segment elevation. No prior EKG available for comparison.', impression:'T-wave inversions in the anterior leads without ST elevation; correlate with troponin trend, concerning for NSTEMI.'} },
    seedHP:{ cc:'Substernal chest pressure radiating to the left arm, 3 hours.',
      hpi:'58-year-old woman with hyperlipidemia and type 2 diabetes presents with 3 hours of substernal chest pressure radiating to the left arm, associated with diaphoresis and nausea, that began at rest while watching television. No relief with rest.',
      pmh:'Hyperlipidemia; type 2 diabetes mellitus.', psh:'None.', meds:'Metformin 1000 mg BID; rosuvastatin 20 mg daily.', allergies:'NKDA.',
      fhx:'Father — MI at age 60. Sister — coronary stent at age 55.', shx:'Works as an accountant. Never smoker, no alcohol use.',
      ros:'Positive for chest pressure, diaphoresis, nausea. Negative for shortness of breath at rest, palpitations, syncope.',
      pe:'Diaphoretic, uncomfortable-appearing. Cardiac exam regular rate and rhythm, no murmur, no rub. Lungs clear. No peripheral edema.',
      studies:'Troponin 0.85 and trending upward on repeat, no prior baseline available. BNP mildly elevated at 210. LDL 142. EKG with anterior T-wave inversions, no ST elevation.',
      assessment:'1) NSTEMI (Non-ST-elevation myocardial infarction). 2) Hyperlipidemia, poorly controlled (LDL 142). 3) Type 2 diabetes mellitus.',
      plan:'1) Dual antiplatelet therapy (aspirin plus a P2Y12 inhibitor), anticoagulation per ACS protocol. 2) High-intensity statin, continue home rosuvastatin (uptitrate). 3) Beta-blocker if no contraindication. 4) Cardiology consulted for risk stratification and likely coronary angiography. 5) Serial troponins and EKGs. 6) Hold metformin pending possible contrast administration; monitor glucose. 7) Telemetry monitoring.' } },

  { id:'p11', last:'Webb', first:'Marcus', mrn:'TR-100330', dob:'1990-08-08', sex:'M', room:'4216',
    admitAt:daysAgo(2), attending:'Dr. Samuel Okafor', team:'Medicine B', codeStatus:'Full Code',
    chiefComplaint:'Redness and swelling of the left foot, worsening x4 days',
    allergies:['NKDA'], problemList:['Type 2 diabetes mellitus, poorly controlled'],
    homeMeds:['Metformin 1000 mg PO BID','Glipizide 10 mg PO daily'],
    vitals:{temp:100.9,hr:98,bp:'134/82',rr:18,spo2:98,pain:5},
    labProfile:{wbc:13.1, glu:240, hba1c:9.8},
    imagingFindings:{ xrExtremity:{findings:'Diffuse soft tissue swelling of the dorsal and plantar foot without periosteal reaction, cortical destruction, or gas within the soft tissues.', impression:'Soft tissue swelling consistent with cellulitis; no radiographic evidence of osteomyelitis at this time.'} },
    seedHP:{ cc:'Redness, warmth, and swelling of the left foot for 4 days.',
      hpi:'34-year-old man with poorly controlled type 2 diabetes presents with 4 days of progressive redness, warmth, and swelling of the left foot beginning at a small blister on the plantar surface. Now with fever and increasing pain. No penetrating trauma recalled.',
      pmh:'Type 2 diabetes mellitus, poorly controlled (last known HbA1c >9).', psh:'None.', meds:'Metformin 1000 mg BID; glipizide 10 mg daily.', allergies:'NKDA.',
      fhx:'Father — type 2 diabetes, below-knee amputation.', shx:'Works in a warehouse. Never smoker, occasional alcohol use.',
      ros:'Positive for foot redness, swelling, fever, pain. Negative for numbness (though reports baseline decreased sensation), red streaking above the ankle, chills.',
      pe:'Febrile. Left foot with well-demarcated erythema and warmth over the dorsum extending to the mid-foot, mild induration, small plantar ulceration with serous drainage, no fluctuance or crepitus. Decreased monofilament sensation bilaterally. Palpable dorsalis pedis pulse.',
      studies:'WBC 13.1, glucose 240, HbA1c 9.8. Foot x-ray with soft tissue swelling, no osteomyelitis or gas.',
      assessment:'1) Cellulitis of the left foot in the setting of diabetic neuropathy and a plantar ulcer, no current radiographic evidence of osteomyelitis. 2) Type 2 diabetes mellitus, poorly controlled.',
      plan:'1) IV antibiotics with coverage for skin/soft-tissue flora (e.g., vancomycin plus piperacillin-tazobactam given diabetic foot infection risk), narrow based on wound culture. 2) Wound care and podiatry/surgery consultation to assess for debridement. 3) Elevate extremity, offload pressure. 4) Improve glycemic control (basal-bolus insulin during admission), diabetes education. 5) Monitor for escalation (repeat imaging or MRI if concern for osteomyelitis develops). 6) Vascular assessment given neuropathy and infection risk.' } },

  { id:'p12', last:'Carter', first:'Destiny', mrn:'TR-100341', dob:'2002-10-25', sex:'F', room:'4108B',
    admitAt:daysAgo(1), attending:'Dr. Renata Kowalski', team:'Medicine B', codeStatus:'Full Code',
    chiefComplaint:'Shortness of breath and wheezing x1 day',
    allergies:['NKDA'], problemList:['Asthma, moderate persistent'],
    homeMeds:['Fluticasone/salmeterol inhaler BID','Albuterol inhaler PRN'],
    vitals:{temp:98.7,hr:108,bp:'118/72',rr:26,spo2:93,pain:0},
    labProfile:{ph:7.46, pco2:30, po2:88, wbc:8.4},
    imagingFindings:{ cxr:{findings:'Hyperinflated lungs without focal consolidation, effusion, or pneumothorax.', impression:'Findings consistent with asthma exacerbation; no acute infiltrate.'} },
    seedHP:{ cc:'Progressive shortness of breath and wheezing, 1 day.',
      hpi:'24-year-old woman with moderate persistent asthma presents with 1 day of worsening shortness of breath, wheeze, and chest tightness following an upper respiratory illness. Using albuterol every 2 hours with only brief relief. No fever.',
      pmh:'Moderate persistent asthma, prior one hospitalization 3 years ago, no prior intubation.', psh:'None.',
      meds:'Fluticasone/salmeterol BID; albuterol PRN.', allergies:'NKDA.', fhx:'Mother — asthma. Brother — eczema.',
      shx:'Works as a barista. Never smoker, occasional alcohol use, denies illicit drugs. Cat at home.',
      ros:'Positive for dyspnea, wheeze, chest tightness, recent congestion/sore throat. Negative for fever, hemoptysis, leg swelling.',
      pe:'Tachypneic, using mild accessory muscles. Diffuse expiratory wheezing bilaterally with a prolonged expiratory phase; moves air adequately without silent chest. Speaking in full sentences with effort.',
      studies:'VBG with mild respiratory alkalosis (pH 7.46, pCO2 30), pO2 88. CXR with hyperinflation, no infiltrate.',
      assessment:'1) Acute moderate asthma exacerbation, likely viral trigger.',
      plan:'1) Continuous then scheduled nebulized albuterol/ipratropium. 2) Systemic corticosteroids (oral prednisone). 3) Supplemental oxygen to maintain SpO2 >92%. 4) Monitor peak flow and work of breathing closely; escalate to ICU/consider BiPAP if fatigue or rising pCO2. 5) Continue home controller inhaler, reinforce inhaler technique and asthma action plan before discharge. 6) Consider allergy/pulmonology follow-up.' } },

  { id:'p13', last:"O'Malley", first:'Kevin', mrn:'TR-100352', dob:'1979-01-17', sex:'M', room:'4218',
    admitAt:daysAgo(1), attending:'Dr. Samuel Okafor', team:'Surgery', codeStatus:'Full Code',
    chiefComplaint:'Severe epigastric pain radiating to the back x1 day',
    allergies:['NKDA'], problemList:['Gallstones (known, asymptomatic)'], homeMeds:[],
    vitals:{temp:100.3,hr:108,bp:'128/78',rr:20,spo2:97,pain:8},
    labProfile:{lipase:1250, ast:78, alt:92, tbili:1.8, wbc:12.9, glu:142},
    imagingFindings:{ usRuq:{findings:'Multiple gallstones present within a non-distended gallbladder without wall thickening. Common bile duct is normal in caliber. Pancreas is not well visualized due to overlying bowel gas.', impression:'Cholelithiasis without evidence of acute cholecystitis or ductal dilation.'},
      ctAbdPelvis:{findings:'Peripancreatic fat stranding and mild pancreatic edema without discrete fluid collection, necrosis, or abscess.', impression:'Findings consistent with acute interstitial pancreatitis; no evidence of necrotizing pancreatitis.'} },
    seedHP:{ cc:'Severe epigastric pain radiating to the back, 1 day.',
      hpi:'47-year-old man with known asymptomatic gallstones presents with 1 day of severe, constant epigastric pain radiating straight through to the back, associated with nausea and repeated vomiting, worse after a large fatty meal yesterday. Denies significant alcohol use.',
      pmh:'Cholelithiasis (known, previously asymptomatic).', psh:'None.', meds:'None.', allergies:'NKDA.',
      fhx:'Mother — gallstones.', shx:'Works in construction. Occasional alcohol use (~2 drinks/week), denies heavy use. Never smoker.',
      ros:'Positive for epigastric pain, back radiation, nausea, vomiting. Negative for fever until today, jaundice, dark urine, hematemesis.',
      pe:'Low-grade fever, tachycardic. Epigastric tenderness to palpation without rebound or guarding; abdomen mildly distended, hypoactive bowel sounds. No jaundice.',
      studies:'Lipase markedly elevated at 1250. Mild transaminitis, total bilirubin 1.8. WBC 12.9. RUQ ultrasound with gallstones, no CBD dilation. CT abdomen/pelvis with peripancreatic stranding, no necrosis.',
      assessment:'1) Acute gallstone (biliary) pancreatitis, interstitial (non-necrotizing) by imaging, mild-to-moderate severity.',
      plan:'1) Aggressive IV isotonic fluid resuscitation. 2) NPO initially, advance diet as tolerated once pain and nausea improve. 3) Analgesia and antiemetics. 4) Surgery to evaluate for cholecystectomy during this admission once pancreatitis clinically improving, given gallstone etiology. 5) Trend lipase, liver enzymes, and inflammatory markers; monitor for signs of necrotizing pancreatitis or organ dysfunction. 6) Alcohol history reviewed and noncontributory to this episode.' } },

  { id:'p14', last:'Thompson', first:'Grace', mrn:'TR-100363', dob:'1963-03-02', sex:'F', room:'4112',
    admitAt:daysAgo(1), attending:'Dr. Patricia Alvarez', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Sudden shortness of breath and right calf pain x1 day',
    allergies:['NKDA'], problemList:['Recent right knee arthroplasty (3 weeks ago)'], homeMeds:['Acetaminophen PRN'],
    vitals:{temp:99.3,hr:118,bp:'108/68',rr:28,spo2:89,pain:4},
    labProfile:{ddimer:3.2, troponin:0.05, bnp:180, po2:65, pco2:32},
    imagingFindings:{ ctChestPE:{findings:'Filling defect within the right main pulmonary artery extending into the right lower lobe segmental branches.', impression:'Acute pulmonary embolism involving the right main and segmental pulmonary arteries.'},
      usDvt:{findings:'Noncompressible, echogenic thrombus within the left popliteal vein with absent Doppler flow. Femoral and common femoral veins are compressible.', impression:'Acute deep venous thrombosis of the left popliteal vein.'} },
    seedHP:{ cc:'Sudden-onset shortness of breath and right calf pain, 1 day.',
      hpi:'63-year-old woman, 3 weeks status post right knee arthroplasty, presents with acute-onset dyspnea and pleuritic chest discomfort that began this morning, along with several days of left calf swelling and pain that she attributed to post-surgical recovery. No hemoptysis.',
      pmh:'Osteoarthritis, status post right total knee arthroplasty 3 weeks ago.', psh:'Right total knee arthroplasty.',
      meds:'Acetaminophen PRN (was not on post-op anticoagulation per report).', allergies:'NKDA.', fhx:'Sister — history of blood clot after pregnancy.',
      shx:'Retired teacher, been largely sedentary since surgery. Never smoker, no alcohol use.',
      ros:'Positive for acute dyspnea, pleuritic chest discomfort, left leg swelling/pain. Negative for hemoptysis, syncope, fever.',
      pe:'Tachycardic, tachypneic, hypoxic (SpO2 89% RA). Right heart strain findings not grossly apparent on exam. Left calf with swelling, warmth, and tenderness, positive Homans sign. Lungs clear to auscultation.',
      studies:'D-dimer markedly elevated at 3.2. Troponin borderline at 0.05, BNP mildly elevated at 180 (suggesting right heart strain). CT chest with acute PE in the right pulmonary artery and segmental branches. Lower extremity Doppler with acute left popliteal DVT.',
      assessment:'1) Acute pulmonary embolism, submassive given mild troponin/BNP elevation without hypotension, provoked by recent orthopedic surgery and immobility. 2) Acute left popliteal DVT, same provoking factor.',
      plan:'1) Therapeutic anticoagulation (heparin drip, transition to a DOAC once stable). 2) Supplemental oxygen. 3) Close monitoring for hemodynamic decompensation given submassive features; discuss with cardiology/pulmonology regarding thrombolysis threshold if the patient deteriorates. 4) Continuous telemetry and serial troponin/BNP. 5) Early mobilization as tolerated once anticoagulated. 6) Extended-duration anticoagulation planning at discharge (minimum 3 months given provoked event) with follow-up.' } },

  { id:'p15', last:'Yang', first:'Robert', mrn:'TR-100374', dob:'1954-05-30', sex:'M', room:'4114',
    admitAt:daysAgo(1), attending:'Dr. Marcus Ihejirika', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Fainting episode this morning while standing up',
    allergies:['NKDA'], problemList:['Hypertension','Benign prostatic hyperplasia'],
    homeMeds:['Hydrochlorothiazide 25 mg PO daily','Tamsulosin 0.4 mg PO daily'],
    vitals:{temp:98.1,hr:64,bp:'128/76',rr:16,spo2:98,pain:0},
    labProfile:{troponin:0.01},
    imagingFindings:{ ekg:{findings:'First-degree AV block (PR interval 240 ms). Normal axis. No ST-T wave abnormality.', impression:'First-degree AV block; otherwise unremarkable EKG.'},
      tte:{findings:'Mild concentric left ventricular hypertrophy. Ejection fraction estimated at 55%. No significant valvular stenosis or regurgitation.', impression:'Mild LVH with preserved ejection fraction; no significant structural abnormality to explain syncope.'} },
    seedHP:{ cc:'Syncopal episode this morning.',
      hpi:'72-year-old man with hypertension and BPH presents after a witnessed syncopal episode this morning while standing up quickly from bed, with rapid return to baseline mental status, no seizure activity, tongue biting, or incontinence. Reports feeling lightheaded briefly beforehand. No chest pain or palpitations preceding the event.',
      pmh:'Hypertension; benign prostatic hyperplasia.', psh:'None.', meds:'Hydrochlorothiazide 25 mg daily; tamsulosin 0.4 mg daily.', allergies:'NKDA.',
      fhx:'Father — pacemaker in his 80s.', shx:'Retired engineer, lives with spouse. Never smoker, occasional alcohol use.',
      ros:'Positive for one syncopal episode, brief presyncope. Negative for chest pain, palpitations, seizure activity, incontinence, head trauma.',
      pe:'Orthostatic vital signs positive (systolic drop >20 mmHg with standing, symptomatic). Cardiac exam regular rate and rhythm, no murmur. Neurologic exam nonfocal.',
      studies:'Troponin normal. EKG with first-degree AV block, otherwise unremarkable. TTE with mild LVH, EF 55%, no significant valvular disease.',
      assessment:'1) Syncope, most consistent with orthostatic hypotension in the setting of hydrochlorothiazide and tamsulosin, low-risk features on initial cardiac workup. 2) First-degree AV block, likely incidental/age-related. 3) Hypertension.',
      plan:'1) Telemetry monitoring overnight to further evaluate for arrhythmia given first-degree AV block. 2) Hold hydrochlorothiazide and reassess blood pressure regimen; consider holding or timing tamsulosin differently. 3) Orthostatic vital sign monitoring, fall-precaution measures. 4) Cardiology to review telemetry and echocardiogram. 5) Outpatient primary care follow-up for blood pressure regimen adjustment.' } },

  { id:'p16', last:'Petrovic', first:'Frank', mrn:'TR-100388', dob:'1975-09-12', sex:'M', room:'4222',
    admitAt:daysAgo(1), attending:'Dr. Renata Kowalski', team:'Medicine B', codeStatus:'Full Code',
    chiefComplaint:'Tremors, anxiety, and one witnessed seizure after stopping alcohol use 2 days ago',
    allergies:['NKDA'], problemList:['Alcohol use disorder'], homeMeds:[],
    vitals:{temp:99.6,hr:118,bp:'156/96',rr:20,spo2:98,pain:2},
    labProfile:{mg:1.4, phos:2.1, plt:68, ast:110, alt:64, tprotein:6.1, albumin:3.0},
    seedHP:{ cc:'Tremor, anxiety, and one witnessed seizure since stopping alcohol 2 days ago.',
      hpi:'51-year-old man with alcohol use disorder (reports drinking approximately 12 beers daily for many years) presents 2 days after his last drink with escalating tremor, anxiety, insomnia, and diaphoresis, followed by one witnessed generalized tonic-clonic seizure at home this morning per his brother. No prior withdrawal seizures reported previously.',
      pmh:'Alcohol use disorder, long-standing; history of alcohol-related fatty liver on prior imaging.', psh:'None.', meds:'None.', allergies:'NKDA.',
      fhx:'Father — alcohol use disorder.', shx:'Currently unemployed, lives with his brother. Heavy daily alcohol use as above; smokes about half a pack of cigarettes per day; denies other illicit drug use.',
      ros:'Positive for tremor, anxiety, insomnia, diaphoresis, one seizure. Negative for fever, focal weakness, head trauma reported by collateral.',
      pe:'Tachycardic, hypertensive, diaphoretic, coarse tremor of the outstretched hands. Anxious and mildly agitated but oriented x4 currently. No focal neurologic deficit. No stigmata of acute head trauma.',
      studies:'Magnesium 1.4, phosphorus 2.1 (both low). Platelets 68 (thrombocytopenia). Mild transaminitis, low albumin and total protein consistent with chronic liver disease.',
      assessment:'1) Alcohol withdrawal syndrome, complicated by a withdrawal seizure — high risk for further complications including delirium tremens. 2) Alcohol use disorder. 3) Electrolyte derangements (hypomagnesemia, hypophosphatemia) and thrombocytopenia consistent with chronic alcohol use/early liver disease.',
      plan:'1) Symptom-triggered benzodiazepine dosing per CIWA-Ar protocol, with scheduled dosing given the seizure history and high-risk features. 2) IV thiamine before any dextrose-containing fluids, folate, and a multivitamin. 3) Electrolyte repletion (magnesium, phosphorus). 4) Seizure precautions, frequent neuro checks. 5) Continuous monitoring for escalation to delirium tremens (autonomic instability, hallucinations); low threshold for ICU-level care if uncontrolled. 6) Social work and addiction medicine consultation for outpatient treatment planning at discharge.' } },

  { id:'p17', last:'Rahman', first:'Aisha', mrn:'TR-100395', dob:'1997-06-21', sex:'F', room:'4224',
    admitAt:daysAgo(1), attending:'Dr. Renata Kowalski', team:'Neurology', codeStatus:'Full Code',
    chiefComplaint:'Fever, severe headache, and neck stiffness x1 day, now confused',
    allergies:['NKDA'], problemList:[], homeMeds:[],
    vitals:{temp:103.2,hr:122,bp:'104/64',rr:20,spo2:97,pain:9},
    labProfile:{wbc:17.5, csfwbc:1850, csfprotein:210, csfglucose:28, csfopening:32, glu:95},
    csfGram:'Gram-positive diplococci identified on Gram stain, morphology consistent with Streptococcus pneumoniae.',
    labTextProfile:{ bloodcx:'Preliminary at 10h: Gram-positive cocci in pairs (diplococci) in 2 of 2 bottle sets, pending final speciation.' },
    imagingFindings:{ ctHead:{findings:'No mass effect, midline shift, or hydrocephalus. No acute hemorrhage.', impression:'No contraindication to lumbar puncture; no acute intracranial abnormality.'} },
    seedHP:{ cc:'Fever, severe headache, and neck stiffness for 1 day, now with confusion.',
      hpi:'29-year-old previously healthy woman presents with 1 day of high fever, severe headache, photophobia, and neck stiffness, with new confusion noted by her partner over the last few hours. No recent travel, no known sick contacts, up to date on childhood vaccinations per report though adult vaccination history unclear.',
      pmh:'None.', psh:'None.', meds:'None.', allergies:'NKDA.', fhx:'Noncontributory.',
      shx:'Works as a graphic designer, lives with partner. Never smoker, occasional alcohol use.',
      ros:'Positive for fever, headache, photophobia, neck stiffness, confusion. Negative for focal weakness, rash per exam, recent head trauma.',
      pe:'Febrile to 103.2F, tachycardic. Confused, oriented to person only. Nuchal rigidity present, positive Kernig and Brudzinski signs. No focal motor deficit. No petechial rash noted.',
      studies:'WBC 17.5. CT head without mass effect or hemorrhage, safe to proceed to lumbar puncture. CSF (post-LP) markedly abnormal with WBC 1850, protein 210, glucose 28 (low relative to serum), opening pressure 32; Gram stain with gram-positive diplococci. Blood cultures preliminarily growing gram-positive diplococci as well.',
      assessment:'1) Acute bacterial meningitis, Gram stain and preliminary blood culture morphology consistent with Streptococcus pneumoniae. 2) Altered mental status secondary to meningitis.',
      plan:'1) Empiric IV ceftriaxone plus vancomycin, plus dexamethasone (given prior to or with the first antibiotic dose) for suspected pneumococcal meningitis; narrow once final speciation/sensitivities available. 2) Droplet precautions until 24 hours of effective antibiotics completed; close contacts to be evaluated for prophylaxis per public health guidance. 3) Frequent neurologic checks; low threshold for repeat head imaging if mental status worsens or new focal deficits develop. 4) ICU-level monitoring given altered mental status. 5) Infectious disease consultation. 6) Once stable, catch-up vaccination counseling (pneumococcal, meningococcal) prior to discharge.' } },

  { id:'p18', last:'Coleman', first:'Bettye', mrn:'TR-100402', dob:'1958-02-04', sex:'F', room:'4116',
    admitAt:daysAgo(1), attending:'Dr. Patricia Alvarez', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Generalized weakness and nausea x2 days; missed last two dialysis sessions',
    allergies:['NKDA'], problemList:['End-stage renal disease on hemodialysis','Hypertension'],
    homeMeds:['Sevelamer 800 mg PO with meals','Amlodipine 10 mg PO daily'],
    vitals:{temp:97.9,hr:58,bp:'168/94',rr:22,spo2:95,pain:2},
    labProfile:{k:6.8, cr:6.4, bun:88, hco3:16, na:134},
    imagingFindings:{ ekg:{findings:'Peaked T waves in the precordial leads with mild QRS widening; no clear P waves visible.', impression:'EKG changes consistent with significant hyperkalemia.'} },
    seedHP:{ cc:'Generalized weakness and nausea for 2 days, missed the last two hemodialysis sessions.',
      hpi:'68-year-old woman with end-stage renal disease on hemodialysis (usual schedule Monday/Wednesday/Friday) presents with 2 days of generalized weakness, nausea, and decreased appetite. Missed her last two scheduled dialysis sessions due to transportation problems. No chest pain, though reports occasional palpitations today.',
      pmh:'End-stage renal disease on hemodialysis (3x/week, AV fistula, left arm); hypertension.', psh:'AV fistula creation, left arm.',
      meds:'Sevelamer 800 mg with meals; amlodipine 10 mg daily.', allergies:'NKDA.', fhx:'Mother — hypertension, dialysis-dependent in her final years.',
      shx:'Lives alone, uses medical transport for dialysis. Never smoker, no alcohol use.',
      ros:'Positive for weakness, nausea, decreased appetite, palpitations. Negative for chest pain, shortness of breath at rest, fever.',
      pe:'Bradycardic relative to baseline, hypertensive. Fistula with palpable thrill, no bruit concern. Mild bilateral lower extremity edema. No acute distress at rest but appears fatigued. Neurologic exam nonfocal aside from generalized weakness.',
      studies:'Potassium critically elevated at 6.8, creatinine 6.4, BUN 88, bicarbonate 16 (all consistent with missed dialysis). EKG with peaked T waves and QRS widening consistent with significant hyperkalemia.',
      assessment:'1) Severe hyperkalemia with EKG changes, in the setting of missed hemodialysis sessions — medical emergency. 2) End-stage renal disease on hemodialysis, non-adherent to schedule due to transportation barriers. 3) Metabolic acidosis.',
      plan:'1) Emergent treatment for hyperkalemia: IV calcium gluconate for cardiac membrane stabilization, insulin/dextrose and nebulized albuterol to shift potassium intracellularly, while arranging emergent hemodialysis. 2) Continuous cardiac monitoring until potassium and EKG normalize. 3) Emergent nephrology consultation for urgent dialysis. 4) Social work involvement to address transportation barriers preventing dialysis attendance. 5) Reinforce dietary potassium restriction and dialysis adherence education. 6) Hold amlodipine while hemodynamics are being reassessed.' } },

  { id:'p19', last:'Cross', first:'Nathaniel', mrn:'TR-100418', dob:'1970-11-11', sex:'M', room:'4226',
    admitAt:daysAgo(1), attending:'Dr. Samuel Okafor', team:'Surgery', codeStatus:'Full Code',
    chiefComplaint:'Crampy abdominal pain, distension, and no bowel movement x3 days',
    allergies:['NKDA'], problemList:['Prior exploratory laparotomy for trauma (age 30)'], homeMeds:[],
    vitals:{temp:99.4,hr:104,bp:'122/76',rr:20,spo2:97,pain:7},
    labProfile:{wbc:11.0, lactate:2.0, k:3.2, cl:90},
    imagingFindings:{ kub:{findings:'Multiple dilated loops of small bowel with air-fluid levels on upright imaging. Paucity of gas in the colon and rectum.', impression:'Findings consistent with small bowel obstruction.'},
      ctAbdPelvis:{findings:'Dilated proximal small bowel loops up to 4.5 cm with a discrete transition point in the mid ileum, likely related to adhesions from prior surgery. Distal bowel is decompressed. No free air, and bowel wall enhancement is preserved without evidence of ischemia.', impression:'Small bowel obstruction with a transition point in the mid ileum, likely adhesive; no evidence of ischemia or perforation at this time.'} },
    seedHP:{ cc:'Crampy abdominal pain, distension, nausea, and no bowel movement for 3 days.',
      hpi:'55-year-old man with a history of exploratory laparotomy for trauma 25 years ago presents with 3 days of progressively worsening crampy, colicky abdominal pain, distension, nausea with several episodes of vomiting, and no bowel movement or flatus for 2 days.',
      pmh:'None active.', psh:'Exploratory laparotomy for blunt abdominal trauma (age 30).', meds:'None.', allergies:'NKDA.',
      fhx:'Noncontributory.', shx:'Works as a truck driver. Former smoker, quit 10 years ago. Occasional alcohol use.',
      ros:'Positive for abdominal pain, distension, nausea, vomiting, obstipation. Negative for fever, hematochezia, melena.',
      pe:'Abdomen distended and tympanitic, diffusely tender without rebound or guarding, high-pitched bowel sounds on auscultation. Well-healed midline surgical scar. No palpable hernia. Rectal vault empty, no gross blood.',
      studies:'WBC 11.0, lactate 2.0, mild hypokalemia and hypochloremia consistent with vomiting losses. KUB with dilated small bowel loops and air-fluid levels. CT abdomen/pelvis with a transition point in the mid ileum, likely adhesive, no ischemia.',
      assessment:'1) Small bowel obstruction, likely adhesive given prior laparotomy, without current imaging evidence of ischemia or perforation. 2) Hypokalemia and hypochloremic metabolic derangement from vomiting/NG losses.',
      plan:'1) NPO, nasogastric tube placement for decompression. 2) IV isotonic fluids with electrolyte repletion (potassium, chloride). 3) Serial abdominal exams and labs (WBC, lactate) to monitor for signs of ischemia or perforation; low threshold for surgery if these develop or if the patient fails to improve with conservative management. 4) Surgery following closely; if obstruction fails to resolve with 48–72 hours of conservative management, proceed to operative exploration and adhesiolysis. 5) Analgesia, antiemetics.' } },

  { id:'p20', last:'Malone', first:'Doris', mrn:'TR-100429', dob:'1941-04-08', sex:'F', room:'4120',
    admitAt:daysAgo(1), attending:'Dr. Marcus Ihejirika', team:'Medicine A', codeStatus:'DNR/DNI',
    chiefComplaint:'Fever and generalized weakness x2 days, sent from a skilled nursing facility',
    allergies:['NKDA'], problemList:['Dementia (mild-moderate)','Hypertension','Osteoarthritis'],
    homeMeds:['Donepezil 10 mg PO daily','Amlodipine 5 mg PO daily','Acetaminophen scheduled TID'],
    vitals:{temp:101.6,hr:108,bp:'98/60',rr:22,spo2:94,pain:3},
    labProfile:{wbc:18.9, lactate:3.4, cr:1.8, bun:34},
    labTextProfile:{ bloodcx:'Pending — no growth to date on either bottle set. Final results in 5 days if no growth.' },
    imagingFindings:{ cxr:{findings:'Lungs are clear without focal consolidation or effusion.', impression:'No radiographic evidence of pneumonia as a source of infection.'} },
    seedHP:{ cc:'Fever and generalized weakness for 2 days, sent from a skilled nursing facility for evaluation.',
      hpi:'84-year-old woman with mild-moderate dementia, residing at a skilled nursing facility, was sent in for 2 days of fever and generalized weakness noted by nursing staff, with decreased oral intake and increased confusion from her baseline. No clearly localizing symptoms reported by facility staff; no documented cough, dysuria, or focal pain.',
      pmh:'Mild-moderate dementia; hypertension; osteoarthritis.', psh:'Total hip arthroplasty (right).',
      meds:'Donepezil 10 mg daily; amlodipine 5 mg daily; scheduled acetaminophen.', allergies:'NKDA.', fhx:'Not obtainable — patient is a poor historian; no family contact available at this visit.',
      shx:'Resides at a skilled nursing facility, requires assistance with ADLs at baseline. Nonsmoker.',
      ros:'Limited by cognitive impairment; positive for fever and reported weakness/decreased intake per facility staff. No clearly localizing complaints obtainable from the patient.',
      pe:'Febrile, tachycardic, borderline hypotensive. Confused, at her reported cognitive baseline per facility report but facility unable to confirm details today. No nuchal rigidity. Lungs clear. No costovertebral angle tenderness. No skin breakdown noted on exam. Abdomen soft, nondistended.',
      studies:'WBC 18.9 with reported bandemia on differential, lactate 3.4, creatinine 1.8 (above documented baseline of 1.0). UA unremarkable. CXR without infiltrate. Blood cultures pending.',
      assessment:'1) Sepsis of unclear source, meeting SIRS/qSOFA criteria, with a currently negative initial urinary and pulmonary workup. 2) Acute kidney injury, likely pre-renal in the setting of sepsis/poor intake. 3) Dementia, acute worsening of confusion likely related to acute illness (delirium superimposed on baseline dementia).',
      plan:'1) IV isotonic fluid resuscitation, reassess volume status given age and cardiac history unknown. 2) Empiric broad-spectrum antibiotics (e.g., vancomycin plus piperacillin-tazobactam) pending source identification, given inability to localize infection on initial workup. 3) Further source workup: skin/pressure-injury exam, consider abdominal imaging if no improvement, review facility records for additional history. 4) Trend lactate and renal function to assess response to treatment. 5) Delirium precautions, reorientation strategies, minimize deliriogenic medications. 6) Goals-of-care discussion given DNR/DNI status and dementia — involve facility-documented healthcare proxy/family as available.' } },

  { id:'p21', last:'Malone', first:'Kevin', mrn:'TR-100440', dob:'1957-11-14', sex:'M', room:'4228',
    admitAt:daysAgo(0), attending:'Dr. Vivian Cho', team:'Cardiology', codeStatus:'Full Code',
    chiefComplaint:'Dizziness and near-syncope x2 weeks, transferred from outpatient clinic for new high-grade AV block',
    allergies:['NKDA'],
    problemList:['Second-degree AV block, Type I (Wenckebach) — new','Coronary artery disease, s/p RCA stenting','Hypertension','Osteoarthritis'],
    homeMeds:['Metoprolol succinate 50 mg PO daily','Lisinopril 10 mg PO daily','Aspirin 81 mg PO daily','Atorvastatin 40 mg PO daily','Acetaminophen 500 mg PO PRN joint pain'],
    vitals:{temp:98.4,hr:45,bp:'118/72',rr:14,spo2:98,pain:0},
    labProfile:{ wbc:6, hgb:16, hct:40, plt:400,
      na:140, k:3.5, cl:99, co2:25, bun:20, cr:1.5, glu:90,
      ast:12, alt:15, alkphos:52, tbili:0.5, albumin:3.8, tprotein:6.0,
      troponin:0.02, bnp:25, tsh:3.0, ft4:1.2, mg:1.7 },
    imagingFindings:{
      ekg:{ findings:'Progressive prolongation of the PR interval over several consecutive beats, culminating in a nonconducted P wave (dropped QRS) in a repeating group-beating pattern, best appreciated on the lead II rhythm strip. Underlying atrial rate approximately 75/min; ventricular rate slower and irregular, averaging in the 40s. QRS complexes are narrow (<120 ms) when conducted. No acute ST-segment or T-wave changes.',
        impression:'Second-degree AV block, Mobitz Type I (Wenckebach). No evidence of acute ischemia.' },
      tte:{ findings:'Left ventricle is normal in size with mildly reduced systolic function, estimated LVEF 50%. Mild akinesis of the basal and mid-inferior walls and inferomedial segments. Right ventricle is mildly dilated with mild hypokinesis, suggestive of prior infarct. Mitral valve demonstrates mild-to-moderate regurgitation. No pericardial effusion.',
        impression:'Mildly reduced LVEF (50%) with a regional wall motion abnormality in the inferior distribution, consistent with prior inferior myocardial infarction (RCA territory). Mild-to-moderate mitral regurgitation.' }
    },
    priorRecords:{
      procedures:[
        { date:'2023-05-20', procId:'pciStent',
          indication:'ST-elevation/non-ST-elevation myocardial infarction involving the right coronary artery territory.',
          note:'Coronary angiography demonstrated a significant stenosis of the right coronary artery (RCA). Percutaneous coronary intervention was performed with successful stent deployment and restoration of TIMI 3 flow. Patient tolerated the procedure well without complication.',
          orderedBy:'Outside cardiology records' }
      ]
    },
    seedHP:{ cc:'Dizziness and lightheadedness, "like I\u2019m going to pass out."',
      hpi:'68-year-old man with hypertension, coronary artery disease (s/p RCA stenting 3 years ago), and osteoarthritis presents to the outpatient office with dizziness and near-syncope, now transferred for further evaluation. He describes 2 weeks of episodic lightheadedness accompanied by a distinct "skipped heartbeat" or sudden pauses in his pulse, along with a mild, non-painful "thumping" sensation in his neck during these spells. Episodes last seconds to minutes, are aggravated by climbing stairs or standing up quickly, and are partially relieved by sitting down, resting, or leaning forward. They occur predictably with exertion, rated 7/10 for impairment due to the sensation of near-syncope. He also reports a month of generalized fatigue and decreased exercise tolerance. He denies true syncope, chest pain, shortness of breath, orthopnea, focal weakness, numbness, or speech changes.',
      pmh:'Essential hypertension. Coronary artery disease (see PSH — RCA stenting). Osteoarthritis.',
      psh:'Percutaneous coronary intervention with stent to the right coronary artery (RCA), 3 years ago. Left total knee arthroplasty, 2021.',
      meds:'Metoprolol succinate 50 mg PO daily; lisinopril 10 mg PO daily; aspirin 81 mg PO daily; atorvastatin 40 mg PO daily; acetaminophen 500 mg PO PRN joint pain.',
      allergies:'NKDA.',
      fhx:'Mother — deceased age 82, vascular dementia and hypertension. Father — deceased age 64, coronary artery disease and type 2 diabetes.',
      shx:'Married, lives at home with wife; retired high school teacher. Denies tobacco or recreational drug use. Endorses 1\u20132 glasses of red wine on weekends. Normal diet. Vaccinations up to date.',
      ros:'Positive for generalized fatigue, episodic lightheadedness/near-syncope, palpitations, and an occasionally slow pulse. Negative for fever, chills, night sweats, weight change, true syncope, chest pain, dyspnea, orthopnea, PND, peripheral edema, focal weakness, numbness, tingling, or tremor.',
      pe:'BP 118/72, HR 45, RR 14, SpO2 98% RA, Temp 98.4\u00b0F. Alert, mildly fatigued, no acute distress at rest. Carotid pulses 2+ bilaterally, notable for an irregular rhythm with occasional pauses; no bruits. Cardiovascular exam with a variable, irregularly irregular bradycardia; normal S1/S2; no murmurs. Lungs clear bilaterally. Peripheral pulses normal, capillary refill <3 sec, no edema. Abdomen benign. Normal strength and grossly intact cranial nerves; stable but cautious gait. A&Ox3, cooperative, normal mood/affect.',
      studies:'12-lead EKG obtained in the office is concerning for a high-grade AV conduction abnormality (see Orders & Results once resulted). Echocardiogram, head CT, and a full laboratory workup (BMP, CBC, troponin, BNP, magnesium, TSH, free T4) are pending on transfer to the ED — order and result each from Orders & Results to review the findings that support the working diagnosis.',
      assessment:'1) Second-degree AV block, Type I (Wenckebach), new \u2014 favored to be multifactorial: age-related conduction system disease, a possible sequela of prior inferior myocardial infarction (the RCA supplies the AV node in the majority of individuals), and a contributory negative dromotropic effect from home metoprolol succinate. 2) Coronary artery disease, stable, s/p RCA stenting. 3) Hypertension, currently well controlled. Differential considered: higher-grade or complete heart block, sick sinus syndrome, acute coronary syndrome, drug-induced sinus/AV-nodal bradycardia, hypothyroidism, hyperkalemia, vasovagal syncope, micturition syncope, and myocarditis.',
      plan:'1) Transfer to the emergency department for further evaluation and monitoring. 2) 12-lead EKG. 3) Transthoracic echocardiogram to establish baseline LVEF prior to possible pacemaker evaluation. 4) Continuous cardiac telemetry monitoring. 5) Hold home metoprolol succinate; reassess conduction after an adequate washout period (metoprolol succinate half-life 3\u20137 hours; ~48-hour washout is a common practice). 6) BMP for electrolytes, CBC (anemia/infection), troponin, BNP, magnesium, TSH, and free T4 to evaluate for reversible or contributing causes. 7) Strict bed rest; ambulate with assistance only, given fall risk. 8) Orthostatic vital signs. 9) Cardiology consult. 10) Head CT given near-syncope and fall risk. 11) NPO in anticipation of a possible procedure (permanent pacemaker), pending cardiology evaluation and metoprolol washout.' } },

  { id:'p22', last:'Dunder', first:'Robert', mrn:'TR-100398', dob:'1952-03-10', sex:'M', room:'4110',
    admitAt:daysAgo(0), attending:'Dr. Marcus Ihejirika', team:'Medicine A', codeStatus:'Full Code',
    chiefComplaint:'Markedly decreased urine output and bilateral lower extremity edema x3 days',
    allergies:['NKDA'],
    problemList:['Acute Kidney Injury, Stage 3 (NSAID-induced, hemodynamic)','Type 2 Diabetes Mellitus, newly diagnosed','Essential Hypertension with end-organ damage','Dyslipidemia with high cardiovascular risk','Obesity'],
    homeMeds:['Ibuprofen 600 mg PO TID (self-directed, past 2 weeks)'],
    vitals:{temp:98.6,hr:92,bp:'168/98',rr:18,spo2:96,pain:0},
    labProfile:{na:134, k:5.6, cl:100, co2:19, bun:88, cr:3.8, glu:348, ast:15, alt:18, alkphos:55, tbili:0.6, albumin:3.2, tprotein:6.8, mg:1.8, phos:5.2, hba1c:10.2, ldl:158, hdl:34, tg:268, totalchol:242,
      wbc:9.8, rbc:4.8, hgb:13.8, hct:42, mcv:88, mch:28.7, mchc:32.8, rdw:13.2, plt:245, segs:62, bands:3, eos:2, baso:0.5, lymphs:28, monos:4.5,
      uasg:1.028, uaph:5.5, uaprotein:3, uaglucose:4, uaketones:1, uablood:0, ualeukest:0, uanitrites:0, uawbc:1, uarbc:0, uacasts:2, uabacteria:0,
      urna:8, urcr:148, urosm:580, fena:0.15, ualb:185, uacrval:125},
    imagingFindings:{
      cxr:{findings:'Mild pulmonary vascular congestion. No focal consolidation or pleural effusion. Heart size mildly enlarged, cardiothoracic ratio 0.55. No pneumothorax.', impression:'Mild pulmonary vascular congestion with mild cardiomegaly, consistent with volume overload.'},
      ekg:{findings:'Normal sinus rhythm at 92 bpm. Left ventricular hypertrophy (Sokolow-Lyon criteria: 38 mm). Left atrial enlargement. Normal intervals. Peaked precordial T waves. No ST-segment or T-wave changes suggestive of acute ischemia.', impression:'Left ventricular hypertrophy and left atrial enlargement consistent with chronic hypertension; peaked T waves concerning for hyperkalemia. No acute ischemic changes.'},
      usRenal:{findings:'Bilateral kidneys normal in size (right 11.2 cm, left 11.5 cm) with increased cortical echogenicity bilaterally, suggesting chronic parenchymal disease consistent with diabetic and/or hypertensive nephropathy. No hydronephrosis or hydroureter. No renal calculi identified. Bladder decompressed with Foley catheter in place.', impression:'No evidence of obstructive uropathy. Increased cortical echogenicity suggests underlying chronic medical renal disease; excludes obstruction as a contributing cause of AKI.'}
    },
    seedHP:{ cc:'Markedly decreased urine output and bilateral leg swelling for 3 days.',
      hpi:'74-year-old male with no prior medical history presents to the outpatient office with a 3-day history of progressive bilateral lower extremity edema, markedly decreased urine output, and generalized fatigue. Ankle swelling began 2 days ago and has extended to the mid-shins, with an estimated 8-lb weight gain over the past 3 days. He estimates 2\u20133 voids in the past 24 hours with very small volumes each time. He endorses increasing fatigue, mild nausea without vomiting, and dull bilateral flank discomfort over the past 48 hours. He also reports persistent thirst, frequent urination, and nocturia (3\u20134 times nightly) over the past several months \u2014 which he attributed to drinking large amounts of sweet tea \u2014 and an unintentional 15-lb weight loss over the past 6 months despite no change in diet. He has taken OTC ibuprofen 600 mg PO TID for the past 2 weeks for chronic low back pain. He has not seen a healthcare provider in over 5 years and takes no prescription medications. Denies fever, hematuria, dysuria, chest pain, or shortness of breath at rest.',
      pmh:'None known. Has not seen a healthcare provider in over 5 years.',
      psh:'Right inguinal hernia repair (age 32).',
      meds:'Ibuprofen 600 mg PO TID (self-directed, past 2 weeks).',
      allergies:'NKDA.',
      fhx:'Mother: deceased, type 2 diabetes mellitus. Father: deceased, premature coronary artery disease (MI at age 58).',
      shx:'Retired and sedentary. Diet consists mainly of fast food and processed meals; drinks 3\u20134 cans regular soda and 2\u20133 glasses sweet tea daily. Former smoker (1 pack/day \u00d7 15 years, quit 5 years ago). Drinks 2\u20133 beers on weekends. Denies illicit drug use. Lives alone. Vaccinations up to date.',
      ros:'Positive: fatigue, malaise, unintentional 15-lb weight loss over 6 months, mild nausea, decreased appetite (3 days), mild dyspnea on exertion (climbing stairs), bilateral lower extremity edema with ~8-lb weight gain over 3 days, chronic nocturia (3\u20134\u00d7/night for months), polyuria/polydipsia (months), mild intermittent tingling in bilateral feet. Negative: fevers, chills, night sweats, rashes, headaches, vision changes, sore throat, cough, wheezing, chest pain, palpitations, orthopnea, vomiting, diarrhea, constipation, dysuria, hematuria, focal weakness, numbness, easy bruising, bleeding, lymphadenopathy.',
      pe:'BP 168/98, HR 92, RR 18, SpO2 96% RA, Temp 98.6\u00b0F. Height 5\'10\', Weight 228 lbs, BMI 32.7 kg/m\u00b2. Obese male appearing fatigued but in no acute distress; alert and cooperative. Skin warm, dry, intact; acanthosis nigricans at posterior neck and bilateral axillae. Fundoscopic exam: scattered dot-and-blot hemorrhages and hard exudates bilaterally. Oropharynx moist, no lesions. Diminished breath sounds at bilateral bases; mild bibasilar crackles. Regular rate and rhythm, normal S1/S2, S4 appreciated at the apex, no murmurs or rubs; peripheral pulses difficult to palpate due to edema. Abdomen soft, obese, nontender; no hepatosplenomegaly or masses. Mild bilateral costovertebral angle tenderness; no suprapubic tenderness. 2+ pitting edema bilaterally, feet to mid-shins; no joint deformity or warmth. Neurologic: A&Ox3; cranial nerves II\u2013XII intact; motor 5/5 upper and lower extremities; decreased sensation to monofilament testing in bilateral feet in a stocking distribution; DTRs 1+ at ankles, 2+ at knees and upper extremities. Appropriate affect, cooperative.',
      studies:'Basic metabolic panel, CBC with differential, HbA1c, magnesium/phosphorus, lipid panel, and urinalysis have resulted and are notable for markedly abnormal renal function, an elevated potassium with corresponding ECG changes, significant new-range hyperglycemia, and marked dyslipidemia \u2014 order and review each panel from Orders & Results for the exact values. Urine studies (sodium, creatinine, osmolality, FENa) and a urine albumin-to-creatinine ratio have also resulted and support a hemodynamic (\u201cpseudo-prerenal\u201d) mechanism rather than acute tubular necrosis, plus pre-existing albuminuria \u2014 order both from Orders & Results for the exact values. Chest X-ray, 12-lead EKG, and renal ultrasound have also resulted \u2014 review each study under Orders & Results to see the actual findings and impressions.',
      assessment:'1) Acute Kidney Injury, Stage 3 \u2014 an estimated 3\u20134-fold rise in creatinine from baseline (see BMP in Orders & Results for the exact value). Multifactorial etiology: (a) NSAID-induced afferent arteriolar vasoconstriction superimposed on (b) chronic volume depletion from unrecognized hyperglycemic osmotic diuresis (a hemodynamically mediated \u201cpseudo-prerenal\u201d pattern), layered on (c) pre-existing subclinical diabetic and hypertensive nephropathy. Urine studies (FENa, urine sodium, urine osmolality, and the BUN:creatinine ratio \u2014 see BMP and the Urine Studies panel) support a hemodynamic mechanism rather than ATN; hyaline casts on urinalysis are nonspecific. Proteinuria and an elevated UACR (see the UACR panel) reflect pre-existing diabetic nephropathy rather than acute injury. Findings on chest imaging indicate volume overload requiring diuresis, not aggressive crystalloid resuscitation. Renal ultrasound excludes obstruction. 2) Essential Hypertension with end-organ damage \u2014 S4 gallop, left ventricular hypertrophy and left atrial enlargement on EKG, nonproliferative diabetic retinopathy, and contribution to nephrosclerosis. 3) Type 2 Diabetes Mellitus, newly diagnosed, with nonproliferative retinopathy and peripheral neuropathy \u2014 classic triad of polyuria, polydipsia, and unintentional weight loss, with markedly elevated random glucose and HbA1c (see labs for exact values); acanthosis nigricans, dot-and-blot hemorrhages/hard exudates, and stocking-distribution sensory loss support chronic undiagnosed hyperglycemia. 4) Dyslipidemia with high cardiovascular risk \u2014 a significantly abnormal lipid panel (see Orders & Results) requiring statin therapy given diabetes, hypertension, obesity, and family history of premature CAD. 5) Hyperkalemia with peaked T waves on EKG \u2014 see BMP and EKG results for details.',
      plan:'TRANSFER TO ED OR ADMIT DIRECTLY IF ADMITTING PRIVILEGES AVAILABLE. AKI management: (1) Discontinue ibuprofen/all NSAIDs immediately. (2) Fluid restriction to 1 L/day; aggressive crystalloid bolus contraindicated. (3) Furosemide 40\u201380 mg IV push now, then titrate to UOP 0.3\u20130.5 mL/kg/hr once euvolemia approached \u2014 goal is decongestion, not forced diuresis. (4) Foley catheter for accurate UOP; reassess volume status frequently. (5) Serial BMP, CBC, phosphorus, magnesium, UA with microscopy, urine electrolytes/FENa, urine osmolality. (6) Renal ultrasound to exclude obstruction \u2014 completed, no obstruction. (7) 12-lead EKG for hyperkalemia changes \u2014 completed. (8) CXR for pulmonary edema/cardiomegaly \u2014 completed. Hyperkalemia management: (9) Calcium gluconate 1 g IV over 2\u20135 min now for cardiac membrane stabilization; repeat if EKG changes persist after 5 min. (10) Insulin 10 units IV + dextrose 25 g IV (D50W 50 mL) to shift potassium intracellularly (onset 10\u201320 min, lasts 4\u20136 hr); monitor glucose closely. (11) Albuterol 10\u201320 mg nebulized (or 0.5 mg IV) for additional potassium shift. Glucose/diabetes management: (12) Hold insulin infusions until oral intake improves. (13) Conservative SQ regimen: basal 10 units daily + rapid-acting 4\u20136 units with meals once tolerating diet. (14) Target fasting glucose 140\u2013180 mg/dL, random <250 mg/dL during acute illness; capillary glucose q4h until stable, then premeal/bedtime; check electrolytes/renal function before insulin dose changes. Hypertension/renoprotection: (15) Withhold ACE-I/ARB during acute AKI. (16) Amlodipine 5 mg PO daily for BP control (safe in AKI). (17) Once AKI resolves, initiate lisinopril or losartan for renoprotection; target BP <130/80 mmHg; recheck BMP 1\u20132 weeks after initiation. Lipid management: (18) Atorvastatin 40 mg PO daily for primary ASCVD prevention; continue despite AKI. Avoid nephrotoxins: (19) Avoid NSAIDs, aminoglycosides, IV contrast, high-dose calcineurin inhibitors until renal function recovers. Patient education: (20) New T2DM diagnosis, lifestyle modification (diet, weight loss, activity). (21) Medication adherence to prevent complications. (22) Complete avoidance of NSAIDs/OTC meds without consulting a provider; mechanism of NSAID-induced kidney injury. (23) Relationship between uncontrolled HTN, diabetes, and progressive kidney disease. (24) Refer to DSMES program and registered dietitian. Emergency return precautions: seek immediate care for anuria, worsening SOB, chest pain, palpitations/irregular heartbeat, confusion/lethargy, or rapidly worsening swelling. Follow-up: (25) Serial BMP q12\u201324h during hospitalization. (26) Transition to outpatient management once AKI resolving. (27) Outpatient PCP follow-up in 1 week; initiate ACE-I/ARB once creatinine stabilizes. (28) Nephrology referral if renal function does not improve within 3\u20137 days or proteinuria persists. (29) Ophthalmology consult for diabetic retinopathy. (30) Cardiology evaluation if LV dysfunction develops.' } },

  {
    id: "p23",
    last: "Martinez",
    first: "Sophia",
    mrn: "TR-100425",
    dob: "1998-03-14",
    sex: "F",
    room: "",
    admitAt: daysAgo(0),
    attending: "Dr. Rachel Chen",
    team: "Gynecology",
    codeStatus: "Full Code",
    chiefComplaint: "Irregular periods and facial hair x3 years",
    allergies: [
      "NKDA"
    ],
    problemList: [
      "Polycystic ovarian syndrome",
      "Acne vulgaris",
      "Obesity",
      "Stage 1 hypertension"
    ],
    homeMeds: [],
    vitals: {
      temp: 98.6,
      hr: 84,
      bp: "138/84",
      rr: 16,
      spo2: 98,
      pain: 0
    },
    labProfile: {
      wbc: 7.2,
      hgb: 13.8,
      hct: 41.5,
      plt: 268,
      na: 138,
      k: 4.1,
      cl: 102,
      co2: 24,
      bun: 16,
      cr: 0.85,
      glu: 101,
      ast: 24,
      alt: 22,
      tsh: 1.8,
      ft4: 1.1,
      totalchol: 218,
      ldl: 145,
      hdl: 38,
      tg: 162,
      glu2hr: 158,
      freeT: 6.8,
      totalT: 58,
      dheas: 185,
      prolactin: 8.2
    },
    imagingFindings: {
      usPelvis: {
        findings: "Right ovary: Volume 12.5 cm³, containing 24 follicles measuring 2–9 mm in diameter, distributed throughout the ovarian stroma. No dominant follicle. Left ovary: Volume 11.8 cm³, containing 22 follicles measuring 2–9 mm, distributed throughout. Bilateral ovarian morphology consistent with polycystic appearance. Endometrium: Measures 8 mm in thickness (normal, not thickened, and no hyperplasia). Uterus: Normal size and echogenicity. No adnexal masses or free fluid.",
        impression: "Bilateral polycystic ovarian morphology. Endometrial thickness and uterine anatomy normal. No evidence of ovarian or adrenal tumor. Findings support diagnosis of PCOS."
      }
    },
    priorRecords: {
      labs: [
        {
          date: "2024-08-27",
          panelId: "cbc",
          values: {
            wbc: 7,
            hgb: 13.5,
            hct: 40.5,
            plt: 265
          }
        },
        {
          date: "2024-08-27",
          panelId: "bmp",
          values: {
            bun: 15,
            cr: 0.84,
            glu: 98
          }
        },
        {
          date: "2024-08-27",
          panelId: "tsh",
          values: {
            tsh: 1.9
          }
        },
        {
          date: "2024-08-27",
          panelId: "ft4",
          values: {
            ft4: 1
          }
        },
        {
          date: "2025-08-27",
          panelId: "cbc",
          values: {
            wbc: 7.1,
            hgb: 13.7,
            hct: 41.2,
            plt: 266
          }
        },
        {
          date: "2025-08-27",
          panelId: "bmp",
          values: {
            bun: 16,
            cr: 0.85,
            glu: 99
          }
        },
        {
          date: "2025-08-27",
          panelId: "tsh",
          values: {
            tsh: 1.8
          }
        },
        {
          date: "2025-08-27",
          panelId: "ft4",
          values: {
            ft4: 1.1
          }
        }
      ]
    },
    seedHP: {
      cc: "Irregular periods and facial hair x3 years",
      hpi: "28-year-old woman presenting to clinic with 3-year history of progressively worsening amenorrhea and hirsutism. Reports menarche age 12 with initially regular 28-day cycles. At age 25, cycles became irregular (40–90 days), progressing to complete amenorrhea for 4–6 month stretches interrupted by heavy vaginal bleeding. Concurrent progressive facial hair (upper lip, chin, lower abdomen), acne resistant to OTC treatments, weight gain ~35 lbs over 3 years despite stable diet/activity. Denies galactorrhea, temperature intolerance. Reports fatigue. Concerned about fertility. Prior TSH and prolactin normal 2 years ago. No OCPs or androgenic agents.",
      pmh: "No significant PMH. Denies diabetes, hypertension, thyroid disease.",
      psh: "None.",
      meds: "None. OTC acne treatments (benzoyl peroxide) without sustained benefit.",
      allergies: "NKDA.",
      fhx: "Mother: Type 2 diabetes, hypertension (diagnosed age 52). Father: Hypertension. Sister: No significant medical history.",
      shx: "Office manager, lives with partner. Exercises 2–3x/week, 30 min. Western diet, occasional fast food. Denies tobacco, illicit drugs. Occasional alcohol (2–3 drinks/week). Vaccinations up to date.",
      ros: "General: Fatigue, occasional mood swings; denies night sweats or unintentional weight loss. Skin: Progressive acne face/upper back, dark coarse hair upper lip/chin/lower abdomen (hirsutism). HEENT: No visual changes, headaches, or galactorrhea. Respiratory: No dyspnea, cough, wheezing. Cardiovascular: No chest pain, palpitations, syncope; BP occasionally elevated at home (140s/80s systolic). GI: No nausea, vomiting, diarrhea, abdominal pain. GU: Irregular menses and amenorrhea as noted; no dysuria, hematuria, polyuria. MSK: No joint pain/swelling. Neuro: No tremor, vertigo, focal deficits. Psych: Occasional mood swings related to menstrual dysfunction; denies suicidal ideation. Endocrine: Fatigue; no temperature intolerance, hyperreflexia, hypothermia. Heme/Lymph: No easy bruising, lymphadenopathy.",
      pe: "Vitals: BP 138/84, HR 84, RR 16, Temp 98.6°F. Ht 5'6\", Wt 195 lbs (BMI 31.5—obese). General: Alert, well-developed woman, no acute distress, mild central obesity. Skin: Multiple comedones/inflammatory papules face/upper back (acne); dark coarse hair upper lip (fine moustache), chin, lower abdomen (male-pattern distribution); no skin tags, acanthosis nigricans. HEENT: Normocephalic, atraumatic, symmetric; no galactorrhea on breast exam. Respiratory: Lungs clear bilaterally. Cardiovascular: RRR, no murmurs/rubs/gallops. Abdomen: Soft, non-tender, no hepatosplenomegaly, normal bowel sounds. Pelvic (external only): No vulvar lesions/discharge, normal labia, no clitoromegaly. Neuro: A&Ox3, CN II–XII intact, motor/sensory intact, no focal deficits. Psych: Cooperative, appropriate affect, no depression/anxiety by observation.",
      studies: "CBC: WBC 7.2, Hgb 13.8, Hct 41.5, Plt 268 (all normal). CMP: Na 138, K 4.1, Cl 102, CO2 24, BUN 16, Cr 0.85, glucose 101 (fasting, abnormal), Ca 9.3, Total Protein 7.0, Albumin 4.2, ALT 22, AST 24, Alk Phos 62, Total Bili 0.7. Lipid Panel: Total Cholesterol 218 (↑), LDL 145 (↑), HDL 38 (↓), TG 162 (↑) — dyslipidemia pattern consistent with metabolic syndrome. OGTT: Fasting glucose 101 (↑), 2-hour glucose 158 (↑) — impaired fasting glucose and impaired glucose tolerance; prediabetes. Endocrine: TSH 1.8 (normal), Free T4 1.1 (normal), Prolactin 8.2 (normal), Free Testosterone 6.8 (↑; normal <4.2 pg/mL), Total Testosterone 58 (↑; normal but elevated for female with symptoms), DHEA-S 185 (normal, 45–270 µg/dL). Pelvic ultrasound (transvaginal): Right ovary volume 12.5 cm³ with 24 follicles 2–9 mm distributed throughout stroma; left ovary volume 11.8 cm³ with 22 follicles 2–9 mm. Bilateral polycystic morphology. Endometrial thickness 8 mm (normal, no hyperplasia). No adnexal masses.",
      assessment: "1) Polycystic ovarian syndrome, confirmed. Meets Rotterdam criteria: oligoamenorrhea/amenorrhea + clinical hyperandrogenism (hirsutism, acne) + polycystic ovary morphology on imaging. Mild biochemical hyperandrogenism (elevated free testosterone, upper-normal total testosterone). Insulin resistance likely given obesity, dyslipidemia, prediabetes. 2) Acne vulgaris, moderate, androgen-driven. 3) Dyslipidemia (elevated LDL, reduced HDL, elevated triglycerides). 4) Impaired glucose tolerance/prediabetes. 5) Obesity (BMI 31.5 kg/m², central distribution). 6) Hypertension, stage 1 (BP 138/84 mmHg). 7) Metabolic syndrome (obesity + hypertension + dyslipidemia + glucose dysregulation).",
      plan: "1) Lifestyle modification (first-line, all PCOS patients): Weight loss goal 5–10% (~10–19 lbs); target 1–2 lbs/week via caloric deficit. Minimum 150 min/week moderate-intensity aerobic + 2–3 days resistance training. Dietary counseling: whole grains, lean proteins, healthy fats, high fiber; limit refined carbs/sugary beverages. Referral to registered dietitian if available. Home BP monitoring; target <130/80 mmHg. 2) Medical management: Combined oral contraceptive pill (OCP) first-line for menstrual regulation and hirsutism/acne (suppress GnRH → reduce ovarian androgens, increase SHBG). Choose lower-androgenic progestin (norgestimate, desogestrel). Start 28-day or extended-cycle regimen. Counsel on break-through bleeding initially and non-contraceptive benefits (acne/hirsutism improvement over 6–12 months). Recheck lipids/glucose after 3 months OCP. 3) Metformin 500 mg BID initially (titrate to minimize GI effects), especially given prediabetes and likely insulin resistance. Improves ovulation rates and metabolic parameters. Monitor renal function; adjust if Cr rises. 4) Consider spironolactone 50–100 mg daily adjunct to OCP if inadequate hirsutism/acne response after 6 months. Monitor K+, Cr. Teratogenic; requires reliable contraception. 5) Blood pressure: Continue lifestyle first; if BP remains ≥130/80 mmHg after 4 weeks, initiate ACE-I or ARB (preferred in reproductive-age woman). 6) Follow-up: Return in 4 weeks for BP recheck, ultrasound review (expected within 2 weeks), androgen/glucose/lipid results review, OCP tolerance assessment. 3-month visit: Assess menses regularity, acne/hirsutism response, weight/lifestyle progress; repeat lipids/glucose if abnormal at baseline. 6-month visit: Comprehensive assessment; consider adding spironolactone if needed. Annual thereafter: Metabolic screening (glucose, lipids, BP), mood/depression screening, metformin renal monitoring if prescribed. At age 40, calculate ASCVD risk. Gynecologic screening per ACOG age-based guidelines (Pap, pelvic exams). 7) Patient education: PCOS is chronic, multifactorial, not curable but highly manageable. Insulin resistance underlying ~70% of PCOS. Fertility: PCOS is leading cause of anovulatory infertility but highly treatable with ovulation induction (clomiphene/letrozole, ~80% ovulation rate, ~50% pregnancy rate per cycle); refer to reproductive endocrinology if pregnancy desired after lifestyle optimization or no spontaneous ovulation within 6 months. Cardiovascular/metabolic risk increased; lifestyle critical. Psychological support offered; screen for depression/anxiety. 8) Red flags: Sudden severe abdominal/pelvic pain (ovarian torsion/rupture), heavy bleeding with hemodynamic instability (anemia, transfusion need), chest pain/SOB (VTE/MI—rare with OCP but consider), severe headache/visual changes with OCP (discontinue, evaluate migraine with aura)."
    }
  },

  {
    id: "p24",
    last: "Torres",
    first: "Maya",
    mrn: "TR-100455",
    dob: "2002-08-18",
    sex: "F",
    room: "—",
    admitAt: daysAgo(0),
    attending: "Unassigned",
    team: "Unassigned",
    codeStatus: "Full Code",
    chiefComplaint: "Migratory joint pain, fever, and a rash on the hands for 4 days",
    allergies: [
      "NKDA"
    ],
    problemList: [
      "Disseminated gonococcal infection (arthritis-dermatitis syndrome)",
      "Chlamydia trachomatis coinfection"
    ],
    homeMeds: [
      "Ethinyl estradiol/norethindrone (combined oral contraceptive) daily",
      "Ibuprofen 400 mg PRN for joint pain"
    ],
    vitals: {
      temp: 100.9,
      hr: 98,
      bp: "112/68",
      rr: 16,
      spo2: 99,
      pain: 6
    },
    labProfile: {
      wbc: 12.4,
      hgb: 12.8,
      hct: 38,
      plt: 310,
      na: 138,
      k: 4,
      cl: 101,
      co2: 24,
      bun: 12,
      cr: 0.7,
      glu: 92,
      esr: 42,
      crp: 38,
      rf: 0,
      ana: 0,
      lymeab: 0,
      synWbc: 18000,
      synPmn: 75
    },
    labTextProfile: {
      bloodcx: "No growth at 24 hours. Final results in 5 days if no growth.",
      stiNaat: "Neisseria gonorrhoeae NAAT (endocervical): Positive. Chlamydia trachomatis NAAT (endocervical): Positive.",
      hivAgAb: "Non-reactive.",
      rpr: "Non-reactive."
    },
    imagingFindings: {
      xrExtremity: {
        findings: "Small joint effusion of the left knee. No fracture, dislocation, periosteal reaction, or erosive changes. No chondrocalcinosis.",
        impression: "Nonspecific joint effusion; no acute osseous abnormality."
      }
    },
    seedHP: {
      cc: "Migratory joint pain, fever, and a rash on the hands for 4 days",
      hpi: "24-year-old woman with 4 days of migratory joint pain beginning in the right wrist and progressing to involve the left knee and right ankle, associated with subjective fever, malaise, and new painless skin lesions on the hands. Reports mild vaginal discharge over the past week attributed to her menstrual cycle, and a new sexual partner over the past 2 months with inconsistent condom use.",
      pmh: "No chronic medical conditions.",
      psh: "None.",
      meds: "Combined oral contraceptive pill daily; ibuprofen 400 mg PRN for joint pain.",
      allergies: "NKDA.",
      fhx: "Mother: hypothyroidism. Father: hypertension. Sibling(s): noncontributory.",
      shx: "Works as a barista. Sexually active with a new male partner over the past 2 months; inconsistent condom use. Denies tobacco use. Drinks alcohol socially. Denies recreational drug use. Vaccinations up to date.",
      ros: "General: fever, malaise. Skin: painless bumps on hands/wrist. Genitourinary: mild vaginal discharge, denies dysuria. Musculoskeletal: migratory joint pain and swelling in right wrist, left knee, right ankle. All other systems negative.",
      pe: "Vitals — BP 112/68, HR 98, RR 16, SpO2 99%, Temp 100.9F. Scattered pustular skin lesions on dorsal hands/wrist. Mucopurulent, friable cervical discharge on speculum exam. Tenosynovitis of the right wrist, left knee effusion, right ankle swelling. Remainder of exam unremarkable.",
      studies: "Neisseria gonorrhoeae NAAT (endocervical): positive. Chlamydia trachomatis NAAT (endocervical): positive. HIV Ag/Ab: non-reactive. RPR: non-reactive. Blood cultures x2: no growth at 24 hours, pending final. Synovial fluid (left knee), obtained via arthrocentesis: WBC 18,000/µL with 75% PMNs, Gram stain negative, culture pending. ESR 42 mm/hr, CRP 38 mg/L. Rheumatoid factor, ANA, and Lyme antibody all negative. Left knee X-ray: small effusion, no fracture or erosive changes.",
      assessment: "1) Disseminated gonococcal infection (arthritis-dermatitis syndrome) 2) Chlamydia trachomatis coinfection",
      plan: "Admit for IV ceftriaxone 1 g q24h with step-down to oral therapy to complete a 7-day minimum course; doxycycline 100 mg PO BID x7 days for confirmed chlamydia coinfection; orthopedic arthrocentesis of the left knee; HIV/syphilis screening; partner notification and treatment; NSAIDs for pain; ID/rheumatology consultation if not improving in 48–72 hours."
    }
  },

  {
    id: "p25",
    last: "Turner",
    first: "Ashley",
    mrn: "TR-100387",
    dob: "1997-03-12",
    sex: "F",
    room: "OB/GYN Clinic – Exam 2",
    admitAt: daysAgo(0),
    attending: "Dr. Renee Castellano",
    team: "Women's Health",
    codeStatus: "Full Code",
    chiefComplaint: "Redness, pain, and warmth of the left breast with fever and chills for 2 days.",
    allergies: [
      "NKDA"
    ],
    problemList: [
      "G1P1, 3 weeks postpartum (uncomplicated spontaneous vaginal delivery)",
      "Exclusively breastfeeding",
      "Areolar fissure, left nipple"
    ],
    homeMeds: [
      "Prenatal multivitamin 1 tablet PO daily",
      "Ibuprofen 400 mg PO PRN pain",
      "Docusate sodium 100 mg PO BID"
    ],
    vitals: {
      temp: 101.4,
      hr: 102,
      bp: "118/72",
      rr: 16,
      spo2: 98,
      pain: 7
    },
    labProfile: {
      wbc: 13.8,
      hgb: 11.8,
      hct: 35,
      plt: 310
    },
    imagingFindings: {
      usBreast: {
        findings: "Left breast, upper-outer quadrant: skin thickening and heterogeneous hypoechoic subcutaneous tissue without a discrete anechoic fluid collection. No drainable fluid collection identified.",
        impression: "Findings consistent with inflammatory changes of lactational mastitis; no discrete abscess identified."
      }
    },
    seedHP: {
      cc: "Redness, pain, and warmth of the left breast with fever and chills for 2 days.",
      hpi: "29-year-old G1P1 female, 3 weeks postpartum from an uncomplicated vaginal delivery, presents with 2 days of progressive left breast pain, redness, and warmth in the upper-outer quadrant. Exclusively breastfeeding; several missed/delayed feeds this week led to engorgement that did not fully resolve with nursing. A small areolar fissure developed about a week ago from latch difficulty. Over the last 24 hours she has developed subjective fever, chills, and malaise, with throbbing pain that worsens with nursing on the affected side but improves after the breast is emptied. She has continued to breastfeed on that side and is anxious about infant safety. Denies cough, dysuria, or abdominal pain.",
      pmh: "Unremarkable. No diabetes, autoimmune disease, or prior breast disease.",
      psh: "None.",
      fhx: "Mother — breast cancer at age 62 (postmenopausal), in remission. Father — hypertension.",
      shx: "Married, stay-at-home parent (first child). Denies tobacco, alcohol, or recreational drug use. Vaccinations up to date. Reports early nipple soreness/cracking in the first two postpartum weeks while establishing latch.",
      ros: "Positive: subjective fever, chills, malaise, fatigue; left breast redness/warmth/tenderness; tender left axillary lump. Negative: cough, dyspnea, chest pain, dysuria, abdominal pain, depressed mood/SI.",
      pe: "Temp 101.4°F, HR 102, BP 118/72, RR 16, SpO2 98% RA. Left breast, upper-outer quadrant, with a well-demarcated wedge-shaped area of erythema ~6x4 cm, warm, tender, mild peau d'orange, without fluctuance; firm non-fluctuant area beneath consistent with inflamed lobule. Small superficial areolar fissure, no purulent drainage. Right breast unremarkable. Single tender mobile ~1 cm left axillary lymph node. Remainder of exam unremarkable; uterine fundus not palpable (expected postpartum involution).",
      studies: "CBC: WBC 13.8 (H) with 78% segs and 8% bands (left shift), Hgb 11.8 (L, physiologic postpartum), Hct 35 (L), platelets 310. CMP within normal limits. Left breast ultrasound (obtained at 60h for persistent induration): skin thickening and heterogeneous hypoechoic subcutaneous tissue without a discrete anechoic fluid collection — no drainable abscess.",
      assessment: "1) Left lactational mastitis, upper-outer quadrant, secondary to milk stasis and an areolar fissure portal of entry, without sonographic evidence of abscess. 2) Areolar skin fissure, left nipple, secondary to latch difficulty. 3) Mild postpartum (physiologic) anemia, incidental, asymptomatic.",
      plan: "1) Continue breastfeeding/pumping on the affected side — do not wean. 2) Dicloxacillin 500 mg PO QID x10–14 days (or cephalexin 500 mg PO QID); avoid TMP-SMX given infant age <1 month (kernicterus risk). 3) Ibuprofen PRN pain/inflammation. 4) Warm compress before feeds, cold after; massage toward nipple during feeds. 5) Lactation consultation this week for latch correction and fissure care. 6) Reassess in 48–72h; obtain breast ultrasound if fluctuant mass develops or no improvement — would need I&D if abscess confirmed. 7) If erythema/skin changes persist despite adequate antibiotics, refer for imaging ± biopsy to exclude inflammatory breast carcinoma. 8) Reassure breastfeeding is safe to continue throughout treatment."
    }
  },

  {
    id: "p26",
    last: "Dawkins",
    first: "Rachel",
    mrn: "TR-100467",
    dob: "1997-02-14",
    sex: "F",
    room: "Clinic 3",
    admitAt: daysAgo(0),
    attending: "Dr. Priya Nandakumar",
    team: "Women's Health",
    codeStatus: "Full Code",
    chiefComplaint: "Right lower quadrant pelvic pain x1 week, worsening x2 days, with amenorrhea and scant vaginal spotting",
    allergies: [
      "NKDA"
    ],
    problemList: [
      "Type 2 diabetes mellitus, poorly controlled",
      "Primary hypothyroidism (Hashimoto thyroiditis)",
      "Polycystic ovary syndrome (historical)"
    ],
    homeMeds: [
      "Metformin 1000 mg PO BID (nonadherent)",
      "Levothyroxine 75 mcg PO daily (nonadherent)",
      "Multivitamin OTC PRN"
    ],
    vitals: {
      temp: 98.4,
      hr: 98,
      bp: "108/68",
      rr: 16,
      spo2: 99,
      pain: 5
    },
    labProfile: {
      glu: 214,
      wbc: 8.9,
      hgb: 11.2,
      hct: 33.8,
      plt: 241,
      na: 138,
      k: 4.2,
      cl: 101,
      co2: 24,
      bun: 14,
      cr: 0.8,
      tsh: 9.4,
      ft4: 0.8,
      hba1c: 9.8,
      hcgqual: 1,
      hcgquant: 1610
    },
    labTextProfile: {
      typescreen: "Blood type O positive. Antibody screen: negative."
    },
    priorRecords: {
      labs: [
        {
          date: "2026-08-25",
          panelId: "hcgQuant",
          values: {
            hcgquant: 1450
          },
          orderedBy: "Outside records (Day 1 draw)"
        }
      ]
    },
    imagingFindings: {
      usPelvis: {
        findings: "Uterus anteverted, normal size and contour, endometrial stripe 9 mm, no intrauterine gestational sac identified. Right adnexa contains a 2.8 cm complex extraovarian mass with a thick echogenic tubal ring, no visible fetal pole or cardiac activity. Moderate free fluid with low-level internal echoes in the posterior cul-de-sac, concerning for hemoperitoneum; no sonographic evidence of frank tubal rupture. Left ovary and adnexa unremarkable.",
        impression: "Findings consistent with right tubal ectopic pregnancy."
      }
    },
    activeMeds: [
      {
        drug: "Metformin",
        dose: "1000 mg",
        route: "PO",
        frequency: "BID",
        indication: "Type 2 diabetes mellitus",
        startDate: "2021-06-10"
      },
      {
        drug: "Levothyroxine",
        dose: "75 mcg",
        route: "PO",
        frequency: "Daily",
        indication: "Primary hypothyroidism",
        startDate: "2019-09-02"
      }
    ],
    seedHP: {
      cc: "Right lower quadrant pelvic pain x1 week, worsening x2 days, with amenorrhea and scant vaginal spotting",
      hpi: "29-year-old woman with poorly controlled type 2 diabetes and undertreated hypothyroidism presents to the outpatient women's health clinic with one week of dull, intermittent right lower quadrant pelvic pain that has become sharper and more constant over the past two days. Last menstrual period was approximately 7 weeks ago, lighter and shorter than usual. Reports 3 days of scant dark brown vaginal spotting, not enough to require a pad. Denies heavy vaginal bleeding, syncope, or dizziness. Intermittent nausea without vomiting. Has not taken a home pregnancy test. Reports mild right shoulder discomfort since yesterday, attributed by the patient to sleeping awkwardly. Denies fever, dysuria, urinary frequency, vaginal discharge, or diarrhea. Admits inconsistent metformin and levothyroxine adherence over the past 2-3 months due to an insurance change and difficulty affording refills. Reports fatigue and unintentional 4-lb weight gain over 2 months.",
      pmh: "Type 2 diabetes mellitus (diagnosed age 24, currently poorly controlled per patient report). Primary hypothyroidism (diagnosed age 22, Hashimoto thyroiditis by prior antibody testing). Polycystic ovary syndrome, historical diagnosis in adolescence, not currently followed. Chlamydial cervicitis/salpingitis treated at age 23.",
      psh: "None.",
      meds: "Metformin 1000 mg PO BID (nonadherent); levothyroxine 75 mcg PO daily (nonadherent); OTC multivitamin taken inconsistently.",
      allergies: "NKDA.",
      fhx: "Mother — type 2 diabetes mellitus, hypothyroidism. Father — hypertension, coronary artery disease diagnosed age 58. One sister, healthy.",
      shx: "Works full-time as a restaurant server. Cohabitating with a male partner of 3 years; sexually active, inconsistent condom use, no other contraception. Denies tobacco use. Alcohol socially, 2-3 drinks per week, last drink 2 weeks ago. Denies recreational drug use. Vaccinations up to date.",
      ros: "Positive for fatigue, cold intolerance, unintentional weight gain, intermittent polyuria/polydipsia, nausea, right lower quadrant pain, 7-week amenorrhea, scant vaginal spotting, mild right shoulder discomfort. Negative for fever, syncope, heavy vaginal bleeding, dysuria, vaginal discharge, diarrhea.",
      pe: "BP 108/68, HR 98, RR 16, SpO2 99% RA, T 98.4F. Alert, mildly uncomfortable, non-toxic appearing. Mild non-tender diffuse thyroid enlargement on palpation, no discrete nodules. Abdomen soft with mild right lower quadrant tenderness, no rebound or guarding. Pelvic exam: scant dark blood at the cervical os, cervix closed; mild right adnexal tenderness and mild right-sided cervical motion tenderness without a clearly palpable mass; uterus normal size and non-tender. No tenderness or restricted range of motion of the right shoulder on exam (referred pain, not musculoskeletal in origin).",
      studies: "Urine/serum qualitative pregnancy test: positive. Quantitative serum beta-hCG: Day 1 1,450 mIU/mL; Day 3 (48-hour recheck) 1,610 mIU/mL (+11%, a suboptimal rise; an expected rise in a viable intrauterine pregnancy is at least 35% over 48 hours). Transvaginal pelvic ultrasound: uterus anteverted, normal size and contour, endometrial stripe 9 mm, no intrauterine gestational sac identified. Right adnexa contains a 2.8 cm complex extraovarian mass with a thick echogenic tubal ring, no visible fetal pole or cardiac activity. Moderate free fluid with low-level internal echoes in the posterior cul-de-sac, concerning for hemoperitoneum; no sonographic evidence of frank tubal rupture. Left ovary and adnexa unremarkable. Impression: findings consistent with right tubal ectopic pregnancy. HbA1c 9.8%. TSH 9.4 (elevated), free T4 0.8 (low-normal), consistent with undertreated hypothyroidism. CBC and CMP otherwise unremarkable aside from hyperglycemia. Blood type O positive, antibody screen negative.",
      assessment: "1) Ectopic pregnancy, unruptured, right tubal, hemodynamically stable. 2) Type 2 diabetes mellitus, poorly controlled, with medication nonadherence. 3) Hypothyroidism, undertreated, likely secondary to medication nonadherence.",
      plan: "1) Confirm hemodynamic stability with repeat vitals and orthostatics; obtain type and screen; administer Rh(D) immune globulin if Rh-negative. 2) Evaluate eligibility for medical management with methotrexate (hemodynamically stable, beta-hCG generally <5,000 mIU/mL, no fetal cardiac activity, no renal/hepatic contraindications); confirm renal function given comorbid diabetes prior to dosing. 3) Arrange serial beta-hCG per methotrexate protocol or surgical referral (salpingostomy/salpingectomy) if criteria for medical management are not met or the patient prefers surgery. 4) Provide explicit return precautions for rupture symptoms: worsening or severe abdominal/pelvic pain, dizziness or syncope, heavy vaginal bleeding, or worsening shoulder pain. 5) Diabetes: reinforce metformin adherence, address medication access/cost barriers via social work or pharmacy assistance, counsel on the importance of glycemic control prior to future pregnancy. 6) Thyroid: reinforce levothyroxine adherence, recheck TSH after adherence is reestablished, counsel on the link between undertreated hypothyroidism and subfertility/early pregnancy loss. 7) Coordinate follow-up with primary care or endocrinology for ongoing diabetes and thyroid management."
    }
  },

  {
    id: "p27",
    last: "Heyward",
    first: "Marcus",
    mrn: "TR-100479",
    dob: "2003-06-14",
    sex: "M",
    room: "UR-4",
    admitAt: daysAgo(0),
    attending: "Dr. A. Whitfield",
    team: "Orthopedics / Urgent Care",
    codeStatus: "Full Code",
    chiefComplaint: "Right knee pain, swelling, and instability after plant-and-pivot injury during soccer practice.",
    allergies: [
      "NKDA"
    ],
    problemList: [
      "Acute right ACL tear (suspected complete, midsubstance)",
      "Acute traumatic hemarthrosis, right knee",
      "Reactive sinus tachycardia (pain-mediated)"
    ],
    homeMeds: [
      "Ibuprofen 400 mg PO PRN pain"
    ],
    vitals: {
      temp: 98.6,
      hr: 96,
      bp: "128/78",
      rr: 16,
      spo2: 99,
      pain: 6
    },
    labProfile: {
      wbc: 10.2,
      hgb: 15.2,
      hct: 44,
      plt: 278,
      na: 139,
      k: 4.1,
      cl: 102,
      co2: 25,
      bun: 14,
      cr: 0.9,
      glu: 92,
      ast: 22,
      alt: 18,
      alkphos: 68,
      tbili: 0.8,
      albumin: 4.5,
      tprotein: 7,
      uacolor: 0,
      uaclarity: 0,
      uasg: 1.018,
      uaph: 6,
      uaprotein: 0,
      uaglucose: 0,
      uaketones: 0,
      uablood: 0,
      ualeukest: 0,
      uanitrites: 0,
      uawbc: 0,
      uarbc: 0,
      uacasts: 0,
      uabacteria: 0
    },
    imagingFindings: {
      xrExtremity: {
        findings: "No acute fracture or dislocation. Cortical margins of the distal femur, proximal tibia, and fibular head are intact. A small cortical irregularity consistent with a Segond fracture pattern (avulsion at the lateral tibial rim, approximately 4 mm) is identified — a pathognomonic radiographic sign of ACL disruption. Moderate periarticular soft tissue swelling. Joint space is maintained. No osseous erosion or periosteal reaction.",
        impression: "Segond fracture of the lateral tibial rim — pathognomonic for ACL tear. Moderate soft tissue swelling consistent with hemarthrosis. No tibial plateau fracture. MRI right knee strongly recommended."
      },
      ekg: {
        findings: "Sinus tachycardia at 96 bpm. Normal axis. Normal PR interval (160 ms). Normal QRS duration. No ST-T wave changes. No prior EKG available for comparison.",
        impression: "Sinus tachycardia. No acute ischemic changes. Clinical context: pain-mediated sympathetic activation in setting of acute musculoskeletal injury."
      }
    },
    priorRecords: {
      labs: [
        {
          date: "2026-07-02",
          panelId: "cbc",
          values: {
            wbc: 6.8,
            hgb: 15.8,
            hct: 46,
            plt: 265,
            segs: 58,
            lymphs: 30,
            monos: 5,
            eos: 2,
            baso: 0.4,
            bands: 3
          },
          orderedBy: "Pre-season physical (outside records)"
        },
        {
          date: "2026-07-02",
          panelId: "cmp",
          values: {
            na: 141,
            k: 4,
            cl: 103,
            co2: 26,
            bun: 13,
            cr: 0.88,
            glu: 88,
            ast: 19,
            alt: 16,
            alkphos: 65,
            tbili: 0.7,
            albumin: 4.6,
            tprotein: 7.1
          },
          orderedBy: "Pre-season physical (outside records)"
        }
      ]
    },
    seedHP: {
      cc: "Right knee pain, swelling, and instability after plant-and-pivot injury during soccer practice.",
      hpi: "Marcus Heyward is a 22-year-old male collegiate soccer midfielder presenting approximately 3 hours after an acute right knee injury sustained during practice. While planting his right foot and pivoting to change direction, he felt and heard an audible 'pop,' immediately fell to the ground, and was unable to bear weight. He reports sharp pain at the time of injury, now described as deep aching pressure with a strong sensation of joint instability ('it went out from under him'). Pain rated 8/10 at time of injury, now 6/10 at rest. No prior knee injuries. The athletic trainer applied ice and compression on the field. He took ibuprofen 400 mg approximately 2 hours ago with minimal relief.",
      pmh: "No chronic medical conditions. Healthy collegiate athlete. No prior musculoskeletal injuries.",
      psh: "None.",
      meds: "Ibuprofen 400 mg orally as needed (taken once 2 hours ago).",
      allergies: "NKDA.",
      fhx: "Father: Hypertension (lisinopril). Mother: Healthy. Sister: Healthy.",
      shx: "Collegiate soccer midfielder. Single, dormitory resident. Occasional social alcohol use (1-2 drinks on weekends). Denies tobacco and recreational drug use. Vaccinations up to date.",
      ros: "Positive: right knee pain, swelling, instability, inability to bear weight, anxiety about athletic career. Negative: fever, chills, headache, chest pain, shortness of breath, nausea, vomiting, numbness or tingling in the right foot (beyond pain-limited function), prior joint hyperlaxity.",
      pe: "Vitals: BP 128/78 mmHg, HR 96 bpm, RR 16, SpO2 99% RA, Temp 98.6 F, Ht 5'11\", Wt 175 lbs. General: Well-developed young male in mild-moderate distress, splinting right knee at approximately 20 degrees of flexion. Skin: Abrasions over right anterior knee; no lacerations or ecchymosis. CV: RRR, S1/S2, no murmurs; distal pulses 2+ bilateral. Right knee (primary): Marked hemarthrosis with visibly distended joint and tense effusion; ballottement of patella positive; limited ROM (extension to 10 degrees, flexion to 80 degrees). Lachman test POSITIVE (Grade 2; soft endpoint, 5-8 mm translation). Anterior Drawer test POSITIVE. Pivot Shift test POSITIVE. McMurray equivocal (limited by guarding). Valgus/varus stress tests negative. Posterior Drawer negative. Fibular head nontender. Peroneal nerve intact. Neuro: Sensation intact L3-S1 bilateral; motor 5/5 except knee extension 4/5 right (pain-limited).",
      studies: "CBC and CMP unremarkable aside from a mild reactive leukocytosis. Urinalysis normal. Right knee radiographs (AP, lateral, tunnel views) with a Segond fracture, pathognomonic for ACL disruption. 12-lead EKG with sinus tachycardia, pain-mediated, no ischemic changes.",
      assessment: "1) Acute right ACL tear — complete midsubstance tear strongly suspected based on mechanism (noncontact plant-and-pivot), immediate hemarthrosis, audible pop, and three concordant positive ligamentous tests (Lachman, Anterior Drawer, Pivot Shift). MRI right knee ordered urgently. 2) Acute traumatic hemarthrosis, right knee — tense effusion in setting of ACL injury. RICE protocol initiated; aspiration deferred. 3) Reactive sinus tachycardia — HR 96 bpm, pain-mediated sympathetic response; no primary cardiac etiology.",
      plan: "1) MRI right knee without contrast (urgent, 24-48 hours) to confirm ACL tear and exclude meniscal/ligamentous co-injury. 2) Right knee radiographs (AP, lateral, tunnel views) — Segond fracture identified on plain film. 3) RICE protocol: rest, ice, compression, elevation. 4) Knee immobilizer and crutches; strict non-weight-bearing right lower extremity. 5) Ibuprofen 600 mg orally q6-8h with food; acetaminophen 500-1000 mg q6-8h PRN adjunct. 6) Orthopedic surgery referral placed (appointment within 5-7 days with MRI results). 7) Prehabilitation physical therapy referral for pre-operative quad strengthening. 8) Athletic trainer and coaching staff notified; patient removed from all practice and play. 9) Return precautions: worsening swelling, numbness/tingling in right foot, vascular compromise — return to ED immediately."
    }
  },

  { id: "p28", last: "Doyle", first: "Margaret", mrn: "TR-100485", dob: "1948-05-09", sex: "F", room: "4122",
    admitAt: daysAgo(0), attending: "Dr. Marcus Ihejirika", team: "Medicine A", codeStatus: "Full Code",
    chiefComplaint: "Fall at home; found weak and confused by her daughter",
    allergies: ["NKDA"],
    problemList: ["Hypertension", "Osteoarthritis", "Bilateral knee replacements", "Hyperlipidemia"],
    homeMeds: ["Hydrochlorothiazide 25 mg PO daily", "Atorvastatin 20 mg PO daily", "Acetaminophen 500 mg PO PRN for joint pain", "Vitamin D3 1000 IU PO daily"],
    vitals: { temp: 98.2, hr: 98, bp: "108/64", rr: 16, spo2: 97, pain: 2 },
    labProfile: {
      na: 122, k: 3.2, cl: 88, co2: 30, bun: 34, cr: 1.3, glu: 92,
      ast: 24, alt: 19, alkphos: 68, tbili: 0.6, albumin: 3.1, tprotein: 5.8,
      wbc: 6.8, rbc: 3.9, hgb: 11.6, hct: 36, mcv: 88, mch: 29.0, mchc: 33, rdw: 13.2, plt: 210,
      segs: 58, bands: 3, eos: 2, baso: 0.3, lymphs: 29, monos: 5,
      uasg: 1.028, uaph: 5.5, uaprotein: 0, uaglucose: 0, uaketones: 0, uablood: 0, ualeukest: 0, uanitrites: 0, uawbc: 2, uarbc: 2, uacasts: 0, uabacteria: 0,
      urna: 42, urosm: 410,
      tsh: 2.8, ft4: 1.2
    },
    imagingFindings: {
      cxr: { findings: "Lungs are clear bilaterally without focal consolidation, effusion, or pneumothorax. Cardiomediastinal silhouette is normal in size and contour. Mild degenerative changes of the thoracic spine.",
        impression: "No acute cardiopulmonary process." },
      ekg: { findings: "Sinus rhythm at 75 bpm. Normal intervals. No acute ST-segment changes.",
        impression: "Normal sinus rhythm; no acute changes." },
      ctHead: { findings: "No acute intracranial hemorrhage, mass effect, or midline shift. No acute infarct. Age-appropriate cerebral volume loss.",
        impression: "No acute intracranial abnormality." }
    },
    priorRecords: {
      labs: [
        { date: "2025-12-27", panelId: "bmp", values: { na: 138, k: 4.0, cl: 101, co2: 25, bun: 15, cr: 0.8, glu: 94 }, orderedBy: "Primary care — outside records" },
        { date: "2026-05-27", panelId: "bmp", values: { na: 136, k: 3.9, cl: 100, co2: 25, bun: 16, cr: 0.9, glu: 96 }, orderedBy: "Primary care — outside records" }
      ]
    },
    seedHP: { cc: "Fall at home; found weak and confused by her daughter.",
      hpi: "Margaret Doyle is a 78-year-old woman brought to the emergency department by her daughter after a fall at home this morning. The patient's husband of 52 years died approximately 3 months ago, and she has been living alone since. Her daughter, who checks in weekly, reports approximately 3 weeks of progressive fatigue, generalized weakness, and poor appetite, stating that her mother has been surviving mostly on tea and toast with minimal other food or fluid intake. The daughter also notes an estimated 9-lb unintentional weight loss over this period and several episodes over the past week of the patient seeming \"foggy\" or slow to answer questions. This morning the patient was found on the kitchen floor after apparently losing her balance while standing from a seated position and falling; there was no witnessed loss of consciousness, seizure activity, or head strike. The patient herself describes about 2 weeks of worsening dizziness, particularly on standing, generalized weakness, and endorses feeling \"not herself\" since her husband's death. She denies chest pain, palpitations, fever, vomiting, diarrhea, or urinary symptoms, and denies any suicidal ideation.",
      pmh: "Hypertension. Osteoarthritis. Bilateral knee replacements. Hyperlipidemia.",
      psh: "Right total knee arthroplasty. Remote appendectomy.",
      meds: "Hydrochlorothiazide 25 mg PO daily; atorvastatin 20 mg PO daily; acetaminophen 500 mg PO PRN for joint pain; vitamin D3 1000 IU PO daily.",
      allergies: "NKDA.",
      fhx: "Mother — hypertension, died age 84 of natural causes. Father — coronary artery disease, myocardial infarction at age 68. One younger brother, living, with hypertension.",
      shx: "Retired schoolteacher. Widowed 3 months ago after a 52-year marriage. Never smoker. Occasional glass of wine in the past; none since her husband's death. Denies recreational drug use. Lives alone in a single-story home; previously independent with all ADLs/IADLs. Vaccinations up to date.",
      ros: "General: Positive for fatigue, generalized weakness, and an estimated 9-lb unintentional weight loss over the past 3 weeks. Denies fever or chills. Skin: Denies rash, itching, or easy bruising aside from the abrasion sustained in this morning's fall. HEENT: Denies headache, vision changes, hearing changes, or sore throat. Endorses a dry mouth. Respiratory: Denies cough, shortness of breath, or wheezing. Cardiovascular: Denies chest pain or palpitations. Endorses lightheadedness with standing. Gastrointestinal: Endorses poor appetite and decreased oral intake for several weeks. Denies nausea, vomiting, diarrhea, constipation, or abdominal pain. Genitourinary: Denies dysuria, urinary frequency, or hematuria. Reports decreased urine output over the past several days. Musculoskeletal: Endorses chronic bilateral knee discomfort at baseline, unchanged. Denies new joint swelling or focal pain aside from the left forearm abrasion. Neurological: Endorses generalized weakness and several days of intermittent mild confusion/slowed thinking per her daughter. Denies focal weakness, numbness, seizure activity, or loss of consciousness with the fall. Psychiatric: Endorses low mood, tearfulness, poor sleep, and decreased interest in previously enjoyed activities since her husband's death. Denies suicidal or homicidal ideation. Endocrine: Denies heat or cold intolerance, excessive thirst, or polyuria. Hematologic/Lymphatic: Denies easy bruising, bleeding, or lymph node swelling.",
      pe: "BP 108/64 mmHg supine, 88/54 mmHg standing. HR 98 bpm supine, 122 bpm standing. RR 16, SpO2 97% RA, Temp 98.2°F. Height 64 in, Weight 118 lb (down from 127 lb). General: Thin, frail-appearing woman in no acute distress; appears fatigued. Skin: Dry with decreased turgor over the forearms; a 2-cm ecchymotic abrasion over the left forearm without active bleeding. HEENT: Dry oral mucous membranes; sunken appearance to the eyes; oropharynx clear without erythema or exudate; no scalp hematoma or facial trauma. Respiratory: Clear to auscultation bilaterally, no wheezes, rales, or rhonchi; no increased work of breathing. Cardiovascular: Tachycardic, regular rhythm, normal S1/S2, no murmurs, rubs, or gallops; no jugular venous distension; capillary refill 3 seconds. Gastrointestinal: Abdomen soft, nontender, nondistended, normoactive bowel sounds; no organomegaly. Genitourinary: Deferred; no gross hematuria or discharge reported. Musculoskeletal: Mild bilateral knee crepitus without effusion or erythema, consistent with known osteoarthritis. Abrasion over the left forearm as above; full range of motion elsewhere; no deformity or focal tenderness; no evidence of hip or long-bone fracture. Neurological: Alert; oriented to person and place, mildly slow and inconsistent orientation to exact date. Cranial nerves II–XII grossly intact. Strength 4/5 in bilateral upper and lower extremities, symmetric, likely reflecting generalized weakness/deconditioning. Sensation grossly intact. No focal deficits. Psychiatric: Affect flat and tearful when discussing her husband; cooperative and appropriate; thought process linear. Endocrine: No thyromegaly or nodules palpated. Hematologic/Lymphatic: No lymphadenopathy; no petechiae beyond the fall-related abrasion.",
      studies: "CMP, CBC with differential, urinalysis, urine sodium/osmolality, TSH/free T4, CT head, chest X-ray, and 12-lead EKG have resulted — order and review each from Orders & Results for the exact values. Notable for severe hyponatremia and hypokalemia, an elevated BUN:creatinine ratio, and low albumin/total protein consistent with malnutrition.",
      assessment: "1) Hypovolemic hyponatremia, severe (Na 122 mEq/L), secondary to hydrochlorothiazide use with contributory low dietary solute and fluid intake (\"tea and toast\" pattern). 2) Acute kidney injury, stage 1, prerenal, secondary to volume depletion. 3) Major depressive disorder / complicated grief, with associated self-neglect and unintentional weight loss. 4) Mechanical fall, multifactorial (orthostatic hypotension, generalized weakness).",
      plan: "1) Hyponatremia: Discontinue hydrochlorothiazide. Monitor urine output hourly; if output exceeds 200 mL/hr or urine becomes abruptly dilute, hold normal saline and initiate desmopressin (DDAVP) to prevent rapid overcorrection. Admit for cautious correction with isotonic (0.9%) normal saline at a conservative rate; avoid free water. Serial BMP every 2–4 hours initially; limit sodium correction to no more than 6–8 mEq/L in the first 24 hours given multiple risk factors for osmotic demyelination syndrome (malnutrition, hypokalemia, presumed chronicity >48 hours). Correct potassium cautiously, with awareness that potassium repletion will also raise serum sodium. Nephrology/endocrinology consultation if correction is difficult to control or overcorrection occurs. 2) Acute kidney injury: Hold nephrotoxic agents; monitor renal function with volume repletion; expect improvement toward baseline as intravascular volume is restored. 3) Nutrition/self-neglect: Nutrition consult; oral nutritional supplementation; sodium- and protein-appropriate diet as tolerated once electrolytes are stabilizing. 4) Fall/safety: Fall precautions; physical therapy/occupational therapy evaluation; home safety assessment prior to discharge. 5) Psychosocial: Administer PHQ-9; social work consultation for grief support and evaluation of home support needs; consider outpatient counseling/bereavement resources; reassess safety (patient currently denies SI/HI). 6) Medication reconciliation: Consider an alternative antihypertensive agent to replace hydrochlorothiazide once stable (e.g., a non-thiazide option), reassessing blood pressure control at follow-up. 7) Case management: Evaluate for home health services, community nutrition support (e.g., Meals on Wheels), and caregiver/family involvement planning prior to discharge." } }
];

  /* Walks a freshly-loaded (fetched) patient array and turns every
     {"__daysAgoOffset__": N} marker back into a real timestamp via
     the same daysAgo() used everywhere else. No-op on data that
     already has a plain numeric admitAt (e.g. PATIENTS_FALLBACK). */
  function resolvePatientDates(patients){
    patients.forEach(function(p){
      if (p.admitAt && typeof p.admitAt === 'object' && p.admitAt.__daysAgoOffset__ !== undefined){
        p.admitAt = daysAgo(p.admitAt.__daysAgoOffset__);
      }
    });
    return patients;
  }

  /* Fetches patientData.json; falls back to the embedded copy above
     if fetch fails (no server / file:// / network hiccup) or the
     response isn't OK. Either way, resolves to a ready-to-use array. */
  function loadPatientData(){
    return fetch('patientData.json')
      .then(function(res){
        if (!res.ok) throw new Error('patientData.json responded with ' + res.status);
        return res.json();
      })
      .then(function(data){ return resolvePatientDates(data); })
      .catch(function(err){
        console.warn('Falling back to embedded patient data (patientData.json could not be loaded — this is expected when opening this file directly as file:// without a local server):', err.message);
        return PATIENTS_FALLBACK;
      });
  }


  /* Quick lookup — includes both the built-in roster and any
     instructor/student-authored custom patients (see STATE.customPatients
     below). reindexPatients() is called after init and whenever a custom
     patient is added or removed. */
  const PATIENT_BY_ID = {};
  function applyPatientOverrides(p){
    const ov = STATE.patientOverrides && STATE.patientOverrides[p.id];
    if (!ov) return p;
    return Object.assign({}, p, ov,
      ov.vitals ? { vitals: Object.assign({}, p.vitals, ov.vitals) } : {}
    );
  }

  function getAllPatients(){
    const deleted = STATE.deletedPatientIds || [];
    return PATIENTS
      .filter(function(p){ return deleted.indexOf(p.id)===-1; })
      .map(applyPatientOverrides)
      .concat(STATE.customPatients||[]);
  }
  function reindexPatients(){
    Object.keys(PATIENT_BY_ID).forEach(function(k){ delete PATIENT_BY_ID[k]; });
    getAllPatients().forEach(function(p){ PATIENT_BY_ID[p.id] = p; });
  }

  /* ---------------------------------------------------------------
     NOTE TEMPLATES — field lists per note type. Seed data above
     supplies a `fields` object per H&P using these same keys; student-
     authored notes are built through the same template in the modal.
  --------------------------------------------------------------- */
  const NOTE_TEMPLATES = {
    hp: { label:'History & Physical', tag:'H&P', fields:[
      {key:'cc', label:'Chief Complaint'},
      {key:'hpi', label:'History of Present Illness'},
      {key:'pmh', label:'Past Medical History'},
      {key:'psh', label:'Past Surgical History'},
      {key:'meds', label:'Home Medications'},
      {key:'allergies', label:'Allergies'},
      {key:'fhx', label:'Family History'},
      {key:'shx', label:'Social History'},
      {key:'ros', label:'Review of Systems'},
      {key:'pe', label:'Physical Examination'},
      {key:'studies', label:'Labs / Imaging Reviewed'},
      {key:'assessment', label:'Assessment'},
      {key:'plan', label:'Plan'}
    ]},
    progress: { label:'Progress Note (SOAP)', tag:'Progress', fields:[
      {key:'subjective', label:'Subjective'},
      {key:'objective', label:'Objective (vitals, exam, interval studies)'},
      {key:'assessment', label:'Assessment'},
      {key:'plan', label:'Plan'}
    ]},
    consult: { label:'Consultation Note', tag:'Consult', fields:[
      {key:'service', label:'Consulting Service'},
      {key:'reason', label:'Reason for Consultation'},
      {key:'hpi', label:'History / Relevant Data'},
      {key:'exam', label:'Pertinent Exam Findings'},
      {key:'assessment', label:'Assessment'},
      {key:'recommendations', label:'Recommendations'}
    ]},
    procedure_note: { label:'Procedure Note', tag:'Procedure', fields:[
      {key:'procedure', label:'Procedure Performed'},
      {key:'indication', label:'Indication'},
      {key:'consent', label:'Consent'},
      {key:'provider', label:'Performing Provider / Assistants'},
      {key:'anesthesia', label:'Anesthesia / Sedation'},
      {key:'technique', label:'Technique / Description'},
      {key:'findings', label:'Findings / Specimens'},
      {key:'complications', label:'Complications'},
      {key:'condition', label:'Patient Condition at Conclusion'},
      {key:'plan', label:'Post-Procedure Plan'}
    ]},
    discharge: { label:'Discharge Summary', tag:'Discharge', fields:[
      {key:'admitDate', label:'Admission Date'},
      {key:'dischargeDate', label:'Discharge Date'},
      {key:'admitDx', label:'Admitting Diagnosis'},
      {key:'dischargeDx', label:'Discharge Diagnosis'},
      {key:'course', label:'Hospital Course'},
      {key:'procedures', label:'Procedures Performed'},
      {key:'dischargeMeds', label:'Discharge Medications'},
      {key:'followup', label:'Follow-up / Discharge Instructions'},
      {key:'disposition', label:'Discharge Disposition'},
      {key:'condition', label:'Condition at Discharge'}
    ]}
  };

  function noteTitle(note){
    const patient = PATIENT_BY_ID[note.patientId];
    const tag = NOTE_TEMPLATES[note.type].tag;
    if (note.type==='hp') return tag+' — '+(patient?patient.first+' '+patient.last:'');
    if (note.type==='consult') return tag+(note.fields.service? (' — '+note.fields.service):'');
    if (note.type==='procedure_note') return tag+(note.fields.procedure ? ' — '+note.fields.procedure : '');
    return tag+' Note';
  }

  function compileNoteHtml(note){
    const tpl = NOTE_TEMPLATES[note.type];
    let html = '';
    tpl.fields.forEach(function(f){
      const val = (note.fields && note.fields[f.key]) ? note.fields[f.key] : '—';
      html += '<h4>'+escapeHtml(f.label)+'</h4><div>'+nl2br(val)+'</div>';
    });
    return html;
  }

  /* ---------------------------------------------------------------
     APP STATE + PERSISTENCE
  --------------------------------------------------------------- */
  const STATE = {
    clinicianName: '',
    currentPatientId: null,
    currentTab: 'overview',
    ordersSubTab: 'place',
    notes: {},   // patientId -> [ {id,type,author,timestamp,fields} ]
    orders: {},  // patientId -> [ {id,category,itemId,label,medData,orderedAt,resultAt,status,result,critical,expanded} ]
    orderCart: {},  // patientId -> [ {domain,itemId,label,medData} ] — staged/unsigned orders, session-only (never persisted)
    customPatients: [],  // instructor/student-authored patients, same shape as built-in PATIENTS entries
    patientOverrides: {},  // patientId -> partial demographic/vitals/clinical overrides for built-in patients
    deletedPatientIds: [],  // ids of built-in patients the instructor has removed from the list
    labOverrides: {},  // patientId -> { activeStageId, stages:[{id,label,profile:{compId:value},textProfile:{panelId:text}}] }
    vitals: {},  // patientId -> [ {id,timestamp,temp,hr,bp,rr,spo2,pain,note,historical} ]
    io: {}       // patientId -> [ {id,timestamp,category,type,amount,note} ]  category: 'intake'|'output'
  };

  function seedNotesForPatient(patient){
    return [{
      id: uid('note'),
      type: 'hp',
      author: patient.attending,
      timestamp: patient.admitAt + 45*60000,
      fields: patient.seedHP
    }];
  }

  function initState(){
    const stored = loadStoredState();
    STATE.customPatients = (stored && Array.isArray(stored.customPatients)) ? stored.customPatients : [];
    STATE.patientOverrides = (stored && stored.patientOverrides && typeof stored.patientOverrides==='object') ? stored.patientOverrides : {};
    STATE.deletedPatientIds = (stored && Array.isArray(stored.deletedPatientIds)) ? stored.deletedPatientIds : [];
    STATE.labOverrides = (stored && stored.labOverrides && typeof stored.labOverrides==='object') ? stored.labOverrides : {};
    reindexPatients();
    getAllPatients().forEach(function(p){
      if (stored && stored.notes && stored.notes[p.id]){
        STATE.notes[p.id] = stored.notes[p.id];
      } else {
        STATE.notes[p.id] = seedNotesForPatient(p);
      }
      if (stored && stored.orders && stored.orders[p.id]){
        STATE.orders[p.id] = stored.orders[p.id];
      } else {
        STATE.orders[p.id] = buildPriorOrders(p);
      }
    });
    if (stored && typeof stored.clinicianName==='string') STATE.clinicianName = stored.clinicianName;
    STATE.vitals = (stored && stored.vitals && typeof stored.vitals==='object') ? stored.vitals : {};
    STATE.io     = (stored && stored.io     && typeof stored.io==='object')     ? stored.io     : {};
    // Seed admission vitals from patient.vitals if none recorded yet
    getAllPatients().forEach(function(p){
      if (!STATE.vitals[p.id]){
        STATE.vitals[p.id] = seedAdmissionVitals(p);
      }
      if (!STATE.io[p.id]) STATE.io[p.id] = [];
    });
    saveStoredState();
  }

  function rewindCaseStage(patientId){
    const entry = STATE.labOverrides[patientId];
    if (entry && entry.stages && entry.stages.length){
      entry.activeStageId = entry.stages[0].id;
    }
  }

  function resetPatientData(patientId){
    const p = PATIENT_BY_ID[patientId];
    STATE.notes[patientId] = seedNotesForPatient(p);
    STATE.orders[patientId] = buildPriorOrders(p);
    STATE.orderCart[patientId] = [];
    STATE.vitals[patientId] = seedAdmissionVitals(p);
    STATE.io[patientId] = [];
    rewindCaseStage(patientId);
    saveStoredState();
  }

  function resetAllData(){
    getAllPatients().forEach(function(p){
      STATE.notes[p.id] = seedNotesForPatient(p);
      STATE.orders[p.id] = buildPriorOrders(p);
      STATE.orderCart[p.id] = [];
      STATE.vitals[p.id] = seedAdmissionVitals(p);
      STATE.io[p.id] = [];
      rewindCaseStage(p.id);
    });
    saveStoredState();
  }

  function addCustomPatient(patient){
    STATE.customPatients.push(patient);
    reindexPatients();
    STATE.notes[patient.id] = seedNotesForPatient(patient);
    STATE.orders[patient.id] = buildPriorOrders(patient);
    STATE.vitals[patient.id] = seedAdmissionVitals(patient);
    STATE.io[patient.id] = [];
    saveStoredState();
  }

  function removeCustomPatient(patientId){
    STATE.customPatients = STATE.customPatients.filter(function(p){ return p.id!==patientId; });
    delete STATE.notes[patientId];
    delete STATE.orders[patientId];
    delete STATE.orderCart[patientId];
    reindexPatients();
    if (STATE.currentPatientId===patientId){
      STATE.currentPatientId = null;
      showView('viewList');
    }
    saveStoredState();
  }

  function randRangeMs(minSec, maxSec){
    return (minSec + Math.random()*(maxSec-minSec)) * 1000;
  }
  const FAST_IMAGING = {cxr:1, ekg:1, kub:1, xrExtremity:1};
  function getTurnaroundMs(category, itemId){
    if (category==='lab') return randRangeMs(6,14);
    if (category==='imaging') return FAST_IMAGING[itemId] ? randRangeMs(5,10) : randRangeMs(14,26);
    if (category==='procedure') return randRangeMs(10,20);
    if (category==='medication') return randRangeMs(3,8);
    return 8000;
  }

  function generateOrderResult(patient, order, clinicianName){
    if (order.category==='lab'){
      const built = buildLabResultText(patient, order.itemId);
      if (built.lines){
        order.critical = built.lines.some(function(l){ return l.flag==='C'; });
        return { kind:'numeric', lines: built.lines };
      }
      return { kind:'text', text: built.text };
    }
    if (order.category==='imaging'){
      return { kind:'text', text: buildImagingReportText(patient, order.itemId, clinicianName) };
    }
    if (order.category==='procedure'){
      return { kind:'text', text: buildProcedureNoteText(patient, order.itemId, clinicianName) };
    }
    if (order.category==='diet'){
      return { kind:'text', text: buildDietOrderText(order.itemId, clinicianName) };
    }
    if (order.category==='medication'){
      const built = order.medData
        ? buildCustomMedicationOrderText(patient, order.medData, clinicianName)
        : buildMedicationOrderText(patient, order.itemId, clinicianName);
      order.critical = built.critical;
      return { kind:'text', text: built.text };
    }
    return { kind:'text', text:'' };
  }

  /* Seed a single admission vitals record from the patient's baseline values */
  function seedAdmissionVitals(patient){
    const v = patient.vitals || {};
    return [{
      id: uid('vs'),
      timestamp: patient.admitAt,
      temp: v.temp || '98.6',
      hr:   v.hr   || '80',
      bp:   v.bp   || '120/80',
      rr:   v.rr   || '16',
      spo2: v.spo2 || '98',
      pain: v.pain || '0',
      note: 'Admission vitals',
      historical: false
    }];
  }

  function placeOrders(patientId, category, items){
    const patient = PATIENT_BY_ID[patientId];
    const now = Date.now();
    if (!STATE.orders[patientId]) STATE.orders[patientId] = [];
    items.forEach(function(item){
      const order = {
        id: uid('ord'),
        category: category,
        itemId: item.id,
        label: item.label,
        medData: item.medData || null,
        orderedBy: STATE.clinicianName || '(name not entered)',
        orderedAt: now,
        resultAt: now + getTurnaroundMs(category, item.id),
        status: 'pending',
        result: null,
        critical: false,
        expanded: false
      };
      STATE.orders[patientId].push(order);
    });
    saveStoredState();
  }

  function tickOrders(){
    let anyChanged = false;
    let changedCurrentPatient = false;
    const now = Date.now();
    Object.keys(STATE.orders).forEach(function(patientId){
      const list = STATE.orders[patientId];
      const patient = PATIENT_BY_ID[patientId];
      list.forEach(function(order){
        if (order.status==='pending' && now >= order.resultAt){
          order.result = generateOrderResult(patient, order, order.orderedBy);
          order.status = 'resulted';
          anyChanged = true;
          if (patientId===STATE.currentPatientId) changedCurrentPatient = true;
        }
      });
    });
    if (anyChanged){
      saveStoredState();
      if (changedCurrentPatient && STATE.currentTab==='orders'){
        renderOrdersPanel(PATIENT_BY_ID[STATE.currentPatientId]);
      }
      if (document.getElementById('viewList').classList.contains('active')) renderPatientList();
    }
  }

  /* ---------------------------------------------------------------
     RENDER: Patient List
  --------------------------------------------------------------- */
  const patientTableBody = document.getElementById('patientTableBody');
  const patientCountEl = document.getElementById('patientCount');
  const searchInput = document.getElementById('searchInput');

  /* Returns count of resulted, current-encounter lab orders that have never
     been expanded (viewed). Historical/prior labs are not counted -- they are
     reference material, not new results requiring attention. */
  function unreadLabCount(patientId){
    return (STATE.orders[patientId] || []).filter(function(o){
      return o.category === 'lab' &&
             o.status   === 'resulted' &&
             !o.historical &&
             !o.expanded;
    }).length;
  }

  function renderPatientList(){
    const q = (searchInput.value||'').trim().toLowerCase();
    const all = getAllPatients();
    const rows = all.filter(function(p){
      if (!q) return true;
      const hay = (p.first+' '+p.last+' '+p.room+' '+p.chiefComplaint+' '+(p.problemList||[]).join(' ')).toLowerCase();
      return hay.indexOf(q)>-1;
    });
    patientCountEl.textContent = '('+rows.length+' of '+all.length+')';
    patientTableBody.innerHTML = rows.map(function(p){
      const age = calcAge(p.dob);
      const allergyChip = (p.allergies.length===1 && p.allergies[0]==='NKDA')
        ? '<span class="pchip">NKDA</span>'
        : '<span class="pchip allergy">'+escapeHtml(p.allergies.join(', '))+'</span>';
      const codeChip = p.codeStatus==='Full Code'
        ? '<span class="pchip code-full">Full Code</span>'
        : '<span class="pchip code-dnr">'+escapeHtml(p.codeStatus)+'</span>';
      const customChip = p.custom ? '<span class="pchip" style="margin-left:5px;">Custom</span>' : '';
      const oc = unreadLabCount(p.id);
      return '<tr data-pid="'+p.id+'">'+
        '<td>'+escapeHtml(p.room)+'</td>'+
        '<td><div class="pname">'+escapeHtml(p.last)+', '+escapeHtml(p.first)+customChip+'</div><div class="pmrn">'+escapeHtml(p.mrn)+'</div></td>'+
        '<td>'+age+' / '+p.sex+'</td>'+
        '<td>'+escapeHtml(p.chiefComplaint)+'</td>'+
        '<td>'+escapeHtml(p.attending)+'<br><span class="pmrn">'+escapeHtml(p.team)+'</span></td>'+
        '<td>'+codeChip+'</td>'+
        '<td>'+allergyChip+'</td>'+
        '<td>'+(oc? '<span class="badge-count">'+oc+'</span>' : '<span class="pmrn">—</span>')+'</td>'+
        '<td><button class="openbtn" type="button">Open Chart</button>'+
          (p.custom ? '<button class="backbtn" data-del-pid="'+p.id+'" type="button" style="padding:6px 9px;font-size:11px;margin-left:6px;">Remove</button>' : '')+
        '</td>'+
        '</tr>';
    }).join('') || '<tr><td colspan="9"><div class="empty-state">No patients match your search.</div></td></tr>';

    Array.prototype.forEach.call(patientTableBody.querySelectorAll('tr[data-pid]'), function(tr){
      tr.addEventListener('click', function(){ openChart(tr.getAttribute('data-pid')); });
    });
    Array.prototype.forEach.call(patientTableBody.querySelectorAll('[data-del-pid]'), function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        const pid = btn.getAttribute('data-del-pid');
        const p = PATIENT_BY_ID[pid];
        if (!p) return;
        const ok = window.confirm('Remove custom patient '+p.first+' '+p.last+'? This deletes the patient and all of their notes and orders. This cannot be undone.');
        if (!ok) return;
        removeCustomPatient(pid);
        renderPatientList();
      });
    });
  }
  searchInput.addEventListener('input', renderPatientList);

  /* ---------------------------------------------------------------
     ADD CUSTOM PATIENT — Quick Builder form + JSON import.
     Both paths funnel through buildCustomPatientFromFields(), which
     fills in reasonable defaults for anything left blank so a minimal
     case (name, DOB, sex, chief complaint, HPI, assessment, plan) is
     enough to produce a usable chart.
  --------------------------------------------------------------- */
  function numOr(v, d){ const n = parseFloat(v); return isNaN(n) ? d : n; }
  function splitList(s){ return (s||'').split(',').map(function(x){ return x.trim(); }).filter(Boolean); }

  function buildCustomPatientFromFields(f){
    const allergies = (f.allergies && f.allergies.length) ? f.allergies : ['NKDA'];
    const homeMeds = f.homeMeds || [];
    const seed = f.seedHP || {};
    return {
      id: uid('cust'),
      custom: true,
      first: f.first, last: f.last, dob: f.dob, sex: f.sex,
      mrn: f.mrn || ('CUST-'+Math.floor(1000+Math.random()*9000)),
      room: f.room || '—',
      admitAt: Date.now(),
      attending: f.attending || 'Unassigned',
      team: f.team || 'Unassigned',
      codeStatus: f.codeStatus || 'Full Code',
      chiefComplaint: f.chiefComplaint,
      allergies: allergies,
      problemList: f.problemList || [],
      homeMeds: homeMeds,
      labProfile: f.labProfile || {},
      labTextProfile: f.labTextProfile || {},
      priorRecords: {
        labs: (f.priorRecords && f.priorRecords.labs) || [],
        imaging: (f.priorRecords && f.priorRecords.imaging) || [],
        procedures: (f.priorRecords && f.priorRecords.procedures) || []
      },
      activeMeds: f.activeMeds || [],
      vitals: {
        temp: numOr(f.vitals && f.vitals.temp, 98.6),
        hr: numOr(f.vitals && f.vitals.hr, 80),
        bp: (f.vitals && f.vitals.bp) || '120/80',
        rr: numOr(f.vitals && f.vitals.rr, 16),
        spo2: numOr(f.vitals && f.vitals.spo2, 98),
        pain: numOr(f.vitals && f.vitals.pain, 0)
      },
      seedHP: {
        cc: f.chiefComplaint,
        hpi: seed.hpi,
        pmh: seed.pmh || 'None on file.',
        psh: seed.psh || 'None on file.',
        meds: seed.meds || (homeMeds.length ? homeMeds.join('; ') : 'None.'),
        allergies: seed.allergies || allergies.join(', ')+'.',
        fhx: seed.fhx || 'Noncontributory.',
        shx: seed.shx || 'Not obtained.',
        ros: seed.ros || 'Not obtained.',
        pe: seed.pe || 'Not documented.',
        studies: seed.studies || 'None on file.',
        assessment: seed.assessment,
        plan: seed.plan
      }
    };
  }

  const PATIENT_JSON_TEMPLATE = {
    first:'Jordan', last:'Ayers', dob:'1975-05-14', sex:'M',
    room:'4230', attending:'Dr. Sample Attending', team:'Medicine C', codeStatus:'Full Code',
    chiefComplaint:'3 days of worsening abdominal pain and vomiting',
    allergies:['NKDA'],
    problemList:['Type 2 diabetes mellitus'],
    homeMeds:[],
    vitals:{ temp:99.5, hr:98, bp:'128/82', rr:18, spo2:97, pain:6 },
    seedHP:{
      hpi:'50-year-old man with type 2 diabetes presents with 3 days of worsening periumbilical pain that has migrated to the right lower quadrant, associated with nausea, vomiting, and anorexia.',
      pmh:'Type 2 diabetes mellitus.', psh:'None.',
      meds:'Metformin 1000 mg BID.', allergies:'NKDA.',
      fhx:'Noncontributory.', shx:'Works as an accountant. No tobacco or alcohol use.',
      ros:'Positive for abdominal pain, nausea, vomiting, anorexia. Negative for diarrhea, hematochezia.',
      pe:'Low-grade fever. Tenderness to palpation in the right lower quadrant with voluntary guarding. Positive rebound tenderness.',
      studies:'WBC mildly elevated. CT abdomen/pelvis pending.',
      assessment:'1) Acute appendicitis, clinically suspected.',
      plan:'1) NPO, IV fluids, analgesia, antiemetics. 2) CT abdomen/pelvis. 3) Surgery consult for likely appendectomy. 4) Empiric antibiotics if perforation suspected.'
    },
    labProfile:{ cr:1.9, bun:34, k:4.6, hgb:10.4 },
    priorRecords:{
      labs:[
        { date:'2022-03-08', panelId:'bmp', values:{ cr:1.1, bun:16 }, orderedBy:'Primary care \u2014 outside records' },
        { date:'2023-02-14', panelId:'bmp', values:{ cr:1.4, bun:21 }, orderedBy:'Primary care \u2014 outside records' },
        { date:'2024-01-22', panelId:'bmp', values:{ cr:1.7, bun:28 }, orderedBy:'Nephrology \u2014 outside records' },
        { date:'2024-11-05', panelId:'cbc', values:{ hgb:10.8 }, orderedBy:'Nephrology \u2014 outside records' }
      ],
      imaging:[
        { date:'2024-01-22', typeId:'usRenal',
          findings:'Kidneys measure 8.9 cm on the right and 9.1 cm on the left, both small for body habitus with increased cortical echogenicity and loss of corticomedullary differentiation. No hydronephrosis.',
          impression:'Bilateral small, echogenic kidneys consistent with chronic medical renal disease.' }
      ],
      procedures:[
        { date:'2021-06-30', procId:'ivPeripheral', indication:'Contrast administration for outpatient imaging.' }
      ]
    },
    activeMeds:[
      { drug:'Metformin', dose:'1000 mg', route:'PO', frequency:'BID', indication:'Type 2 diabetes mellitus', startDate:'2019-04-02' },
      { drug:'Lisinopril', dose:'20 mg', route:'PO', frequency:'Daily', indication:'Hypertension, proteinuria', startDate:'2022-03-15' }
    ]
  };

  const patientModal = document.getElementById('patientModal');
  const psubBuild = document.getElementById('psubBuild');
  const psubImport = document.getElementById('psubImport');
  const pSubBtns = Array.prototype.slice.call(patientModal.querySelectorAll('.subtab-btn'));

  function closePatientModal(){ patientModal.classList.remove('open'); }
  document.getElementById('patientModalClose').addEventListener('click', closePatientModal);
  patientModal.addEventListener('click', function(e){ if (e.target===patientModal) closePatientModal(); });

  function setPatientSub(sub){
    pSubBtns.forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-psub')===sub); });
    psubBuild.classList.toggle('active', sub==='build');
    psubImport.classList.toggle('active', sub==='import');
  }
  pSubBtns.forEach(function(b){ b.addEventListener('click', function(){ setPatientSub(b.getAttribute('data-psub')); }); });

  /* ---------------------------------------------------------------
     Prior-records row builders for the patient builder form. Rows are
     dynamic DOM rather than a fixed form because the number of prior
     results varies by case; each row's fields are read back at save time.
  --------------------------------------------------------------- */
  function histRowShell(kind, inner){
    return '<div class="hist-row" data-hist="'+kind+'">'+inner+
      '<button class="hist-del" type="button" title="Remove this entry" aria-label="Remove this entry">\u2715</button></div>';
  }

  function labPanelOptionsHtml(){
    return buildLabOrderGroups().map(function(g){
      return '<optgroup label="'+escapeHtml(g.category)+'">'+
        g.items.map(function(it){ return '<option value="'+escapeHtml(it.id)+'">'+escapeHtml(it.label)+'</option>'; }).join('')+
        '</optgroup>';
    }).join('');
  }
  function imagingOptionsHtml(){
    return buildImagingOrderGroups().map(function(g){
      return '<optgroup label="'+escapeHtml(g.category)+'">'+
        g.items.map(function(it){ return '<option value="'+escapeHtml(it.id)+'">'+escapeHtml(it.label)+'</option>'; }).join('')+
        '</optgroup>';
    }).join('');
  }
  function procedureOptionsHtml(){
    return buildProcedureOrderGroups().map(function(g){
      return '<optgroup label="'+escapeHtml(g.category)+'">'+
        g.items.map(function(it){ return '<option value="'+escapeHtml(it.id)+'">'+escapeHtml(it.label)+'</option>'; }).join('')+
        '</optgroup>';
    }).join('');
  }

  function renderLabValueFieldsHtml(panelId, values){
    const panel = LAB_PANELS[panelId];
    if (!panel) return '';
    if (panel.kind==='text'){
      const v = (values && values.text) || '';
      return '<div class="field" style="margin:0;"><label>Result Text</label>'+
        '<textarea data-labtext rows="2" placeholder="leave blank for the default normal report">'+escapeHtml(v)+'</textarea></div>';
    }
    return '<div class="hist-vals">'+panel.components.map(function(c){
      const v = (values && values[c.id]!==undefined) ? values[c.id] : '';
      return '<div class="hist-val"><label>'+escapeHtml(c.label)+
        '<span class="hist-val-unit">'+escapeHtml(c.unit||'')+'</span></label>'+
        '<input type="text" data-comp="'+c.id+'" value="'+escapeHtml(String(v))+'" placeholder="'+c.def+'"></div>';
    }).join('')+'</div>';
  }

  function addLabHistRow(entry){
    const host = document.getElementById('npLabRows');
    const e = entry || {};
    const wrap = document.createElement('div');
    wrap.innerHTML = histRowShell('lab',
      '<div class="hist-row-top">'+
        '<div class="field"><label>Date of Service</label><input type="date" data-date value="'+escapeHtml(e.date||'')+'"></div>'+
        '<div class="field"><label>Panel</label><select data-panel>'+labPanelOptionsHtml()+'</select></div>'+
        '<div class="field"><label>Source / Ordering Provider</label><input type="text" data-by value="'+escapeHtml(e.orderedBy||'')+'" placeholder="Outside records"></div>'+
      '</div>'+
      '<div class="hist-vals-host"></div>');
    const row = wrap.firstChild;
    host.appendChild(row);
    const sel = row.querySelector('[data-panel]');
    if (e.panelId) sel.value = e.panelId;
    const valsHost = row.querySelector('.hist-vals-host');
    function paint(){ valsHost.innerHTML = renderLabValueFieldsHtml(sel.value, (e.panelId===sel.value) ? e.values : null); }
    sel.addEventListener('change', paint);
    paint();
    row.querySelector('.hist-del').addEventListener('click', function(){ row.remove(); });
  }

  function addImgHistRow(entry){
    const host = document.getElementById('npImgRows');
    const e = entry || {};
    const wrap = document.createElement('div');
    wrap.innerHTML = histRowShell('img',
      '<div class="hist-row-top">'+
        '<div class="field"><label>Date of Service</label><input type="date" data-date value="'+escapeHtml(e.date||'')+'"></div>'+
        '<div class="field"><label>Study</label><select data-type>'+imagingOptionsHtml()+'</select></div>'+
        '<div class="field"><label>Source</label><input type="text" data-by value="'+escapeHtml(e.orderedBy||'')+'" placeholder="Outside records"></div>'+
      '</div>'+
      '<div class="field" style="margin-bottom:8px;"><label>Findings</label><textarea data-findings rows="2" placeholder="leave blank for the default normal report">'+escapeHtml(e.findings||'')+'</textarea></div>'+
      '<div class="field" style="margin:0;"><label>Impression</label><textarea data-impression rows="2" placeholder="leave blank for the default normal impression">'+escapeHtml(e.impression||'')+'</textarea></div>');
    const row = wrap.firstChild;
    host.appendChild(row);
    if (e.typeId) row.querySelector('[data-type]').value = e.typeId;
    row.querySelector('.hist-del').addEventListener('click', function(){ row.remove(); });
  }

  function addProcHistRow(entry){
    const host = document.getElementById('npProcRows');
    const e = entry || {};
    const wrap = document.createElement('div');
    wrap.innerHTML = histRowShell('proc',
      '<div class="hist-row-top">'+
        '<div class="field"><label>Date of Service</label><input type="date" data-date value="'+escapeHtml(e.date||'')+'"></div>'+
        '<div class="field"><label>Procedure</label><select data-proc>'+procedureOptionsHtml()+'</select></div>'+
        '<div class="field"><label>Source / Performed By</label><input type="text" data-by value="'+escapeHtml(e.orderedBy||'')+'" placeholder="Outside records"></div>'+
      '</div>'+
      '<div class="field" style="margin-bottom:8px;"><label>Indication</label><input type="text" data-indication value="'+escapeHtml(e.indication||'')+'" placeholder="leave blank for the default indication"></div>'+
      '<div class="field" style="margin:0;"><label>Procedure Note</label><textarea data-note rows="2" placeholder="leave blank for the default note">'+escapeHtml(e.note||'')+'</textarea></div>');
    const row = wrap.firstChild;
    host.appendChild(row);
    if (e.procId) row.querySelector('[data-proc]').value = e.procId;
    row.querySelector('.hist-del').addEventListener('click', function(){ row.remove(); });
  }

  function addMedHistRow(entry){
    const host = document.getElementById('npMedRows');
    const e = entry || {};
    const routes = ['PO','IV','IM','SC','SL','PR','Topical','Inhaled','Other'];
    const freqs = ['Daily','BID','TID','QID','Q4H','Q6H','Q8H','Q12H','Weekly','PRN','Continuous infusion','Once / STAT'];
    const wrap = document.createElement('div');
    wrap.innerHTML = histRowShell('med',
      '<div class="hist-row-top">'+
        '<div class="field"><label>Medication</label><input type="text" data-drug value="'+escapeHtml(e.drug||'')+'" placeholder="e.g., Lisinopril"></div>'+
        '<div class="field"><label>Dose</label><input type="text" data-dose value="'+escapeHtml(e.dose||'')+'" placeholder="e.g., 10 mg"></div>'+
        '<div class="field"><label>Start Date</label><input type="date" data-date value="'+escapeHtml(e.startDate||'')+'"></div>'+
      '</div>'+
      '<div class="hist-row-top">'+
        '<div class="field"><label>Route</label><select data-route>'+routes.map(function(r){ return '<option>'+r+'</option>'; }).join('')+'</select></div>'+
        '<div class="field"><label>Frequency</label><select data-freq>'+freqs.map(function(f){ return '<option>'+f+'</option>'; }).join('')+'</select></div>'+
        '<div class="field"><label>Indication</label><input type="text" data-indication value="'+escapeHtml(e.indication||'')+'" placeholder="e.g., hypertension"></div>'+
      '</div>');
    const row = wrap.firstChild;
    host.appendChild(row);
    if (e.route) row.querySelector('[data-route]').value = e.route;
    if (e.frequency) row.querySelector('[data-freq]').value = e.frequency;
    row.querySelector('.hist-del').addEventListener('click', function(){ row.remove(); });
  }

  /* Every unique numeric analyte across all panels, grouped by category, so a
     facilitator can set this admission's values without opening the Facilitator
     Panel separately. */
  function renderBaselineValueFieldsHtml(){
    return getUniqueLabComponentsGrouped().map(function(g){
      return '<details class="order-group"><summary>'+escapeHtml(g.category)+'</summary>'+
        '<div class="hist-vals">'+g.items.map(function(c){
          return '<div class="hist-val"><label>'+escapeHtml(c.label)+
            '<span class="hist-val-unit">'+escapeHtml(c.unit||'')+', ref '+c.range.join('\u2013')+'</span></label>'+
            '<input type="text" data-basecomp="'+c.id+'" placeholder="'+c.def+'"></div>';
        }).join('')+'</div></details>';
    }).join('');
  }

  function readBaselineValuesFromForm(){
    const profile = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-basecomp]'), function(inp){
      const v = inp.value.trim();
      if (v!=='' && !isNaN(parseFloat(v))) profile[inp.getAttribute('data-basecomp')] = parseFloat(v);
    });
    return profile;
  }

  function readPriorRecordsFromForm(){
    const labs = [];
    Array.prototype.forEach.call(document.querySelectorAll('#npLabRows .hist-row'), function(row){
      const date = row.querySelector('[data-date]').value;
      const panelId = row.querySelector('[data-panel]').value;
      if (!date || !panelId) return;
      const values = {};
      const textEl = row.querySelector('[data-labtext]');
      if (textEl){
        if (textEl.value.trim()) values.text = textEl.value.trim();
      } else {
        Array.prototype.forEach.call(row.querySelectorAll('[data-comp]'), function(inp){
          const v = inp.value.trim();
          if (v!=='' && !isNaN(parseFloat(v))) values[inp.getAttribute('data-comp')] = parseFloat(v);
        });
      }
      labs.push({ date:date, panelId:panelId, values:values, orderedBy: row.querySelector('[data-by]').value.trim() || undefined });
    });

    const imaging = [];
    Array.prototype.forEach.call(document.querySelectorAll('#npImgRows .hist-row'), function(row){
      const date = row.querySelector('[data-date]').value;
      const typeId = row.querySelector('[data-type]').value;
      if (!date || !typeId) return;
      imaging.push({
        date:date, typeId:typeId,
        findings: row.querySelector('[data-findings]').value.trim() || undefined,
        impression: row.querySelector('[data-impression]').value.trim() || undefined,
        orderedBy: row.querySelector('[data-by]').value.trim() || undefined
      });
    });

    const procedures = [];
    Array.prototype.forEach.call(document.querySelectorAll('#npProcRows .hist-row'), function(row){
      const date = row.querySelector('[data-date]').value;
      const procId = row.querySelector('[data-proc]').value;
      if (!date || !procId) return;
      procedures.push({
        date:date, procId:procId,
        indication: row.querySelector('[data-indication]').value.trim() || undefined,
        note: row.querySelector('[data-note]').value.trim() || undefined,
        orderedBy: row.querySelector('[data-by]').value.trim() || undefined
      });
    });

    const activeMeds = [];
    Array.prototype.forEach.call(document.querySelectorAll('#npMedRows .hist-row'), function(row){
      const drug = row.querySelector('[data-drug]').value.trim();
      if (!drug) return;
      activeMeds.push({
        drug: drug,
        dose: row.querySelector('[data-dose]').value.trim(),
        route: row.querySelector('[data-route]').value,
        frequency: row.querySelector('[data-freq]').value,
        indication: row.querySelector('[data-indication]').value.trim(),
        startDate: row.querySelector('[data-date]').value || undefined
      });
    });

    return { priorRecords: { labs:labs, imaging:imaging, procedures:procedures }, activeMeds: activeMeds };
  }

  function renderPatientBuilderForm(){
    psubBuild.innerHTML =
      '<div class="card"><h3>Identifying Information</h3>'+
        '<div class="field-row"><div class="field"><label>First Name *</label><input type="text" id="npFirst"></div>'+
          '<div class="field"><label>Last Name *</label><input type="text" id="npLast"></div></div>'+
        '<div class="field-row"><div class="field"><label>Date of Birth *</label><input type="date" id="npDob"></div>'+
          '<div class="field"><label>Sex *</label><select id="npSex"><option value="F">F</option><option value="M">M</option></select></div></div>'+
        '<div class="field-row"><div class="field"><label>Room</label><input type="text" id="npRoom" placeholder="e.g., 4210"></div>'+
          '<div class="field"><label>MRN</label><input type="text" id="npMrn" placeholder="auto-generated if blank"></div></div>'+
        '<div class="field-row"><div class="field"><label>Attending</label><input type="text" id="npAttending" placeholder="e.g., Dr. Jane Kim"></div>'+
          '<div class="field"><label>Team</label><input type="text" id="npTeam" placeholder="e.g., Medicine B"></div></div>'+
        '<div class="field"><label>Code Status</label><select id="npCodeStatus"><option>Full Code</option><option>DNR</option><option>DNR/DNI</option></select></div>'+
      '</div>'+
      '<div class="card"><h3>Clinical Snapshot</h3>'+
        '<div class="field"><label>Chief Complaint *</label><input type="text" id="npCc" placeholder="e.g., Fever and cough x3 days"></div>'+
        '<div class="field-row"><div class="field"><label>Allergies</label><input type="text" id="npAllergies" placeholder="comma-separated, or leave blank for NKDA"></div>'+
          '<div class="field"><label>Problem List</label><input type="text" id="npProblems" placeholder="comma-separated"></div></div>'+
        '<div class="field"><label>Home Medications</label><input type="text" id="npHomeMeds" placeholder="comma-separated"></div>'+
        '<div class="field-row" style="grid-template-columns:repeat(6,1fr);gap:8px;">'+
          '<div class="field"><label>Temp (\u00b0F)</label><input type="text" id="npTemp" placeholder="98.6"></div>'+
          '<div class="field"><label>HR</label><input type="text" id="npHr" placeholder="80"></div>'+
          '<div class="field"><label>BP</label><input type="text" id="npBp" placeholder="120/80"></div>'+
          '<div class="field"><label>RR</label><input type="text" id="npRr" placeholder="16"></div>'+
          '<div class="field"><label>SpO2 (%)</label><input type="text" id="npSpo2" placeholder="98"></div>'+
          '<div class="field"><label>Pain</label><input type="text" id="npPain" placeholder="0"></div>'+
        '</div>'+
      '</div>'+
      '<div class="card"><h3>Admission History &amp; Physical (seeds the chart\u2019s first note)</h3>'+
        '<div class="field"><label>History of Present Illness *</label><textarea id="npHpi" rows="3"></textarea></div>'+
        '<div class="field-row"><div class="field"><label>Past Medical History</label><textarea id="npPmh" rows="2"></textarea></div>'+
          '<div class="field"><label>Past Surgical History</label><textarea id="npPsh" rows="2"></textarea></div></div>'+
        '<div class="field-row"><div class="field"><label>Family History</label><textarea id="npFhx" rows="2"></textarea></div>'+
          '<div class="field"><label>Social History</label><textarea id="npShx" rows="2"></textarea></div></div>'+
        '<div class="field"><label>Review of Systems</label><textarea id="npRos" rows="2"></textarea></div>'+
        '<div class="field"><label>Physical Examination</label><textarea id="npPe" rows="3"></textarea></div>'+
        '<div class="field"><label>Labs / Imaging Reviewed</label><textarea id="npStudies" rows="2"></textarea></div>'+
        '<div class="field"><label>Assessment *</label><textarea id="npAssessment" rows="2"></textarea></div>'+
        '<div class="field"><label>Plan *</label><textarea id="npPlan" rows="3"></textarea></div>'+
      '</div>'+
      '<div class="card"><h3>Prior &amp; Outside Records <span class="opt-tag">optional</span></h3>'+
        '<p style="font-size:12.5px;color:var(--ink-dim);line-height:1.6;margin-top:0;">Results dated before this admission. These appear in Order History under \u201cPrior &amp; Outside Records,\u201d and every numeric lab entered here is pivoted into the Trends tab so students can judge whether an abnormal value is acute or chronic. Leave any analyte blank to use a normal/default value.</p>'+
        '<div class="hist-section"><div class="hist-head">Prior Laboratory Results</div>'+
          '<div id="npLabRows"></div>'+
          '<button class="btn-secondary hist-add" id="npAddLabRow" type="button">+ Add Prior Lab</button>'+
        '</div>'+
        '<div class="hist-section"><div class="hist-head">Prior Imaging Studies</div>'+
          '<div id="npImgRows"></div>'+
          '<button class="btn-secondary hist-add" id="npAddImgRow" type="button">+ Add Prior Imaging</button>'+
        '</div>'+
        '<div class="hist-section"><div class="hist-head">Prior Procedures</div>'+
          '<div id="npProcRows"></div>'+
          '<button class="btn-secondary hist-add" id="npAddProcRow" type="button">+ Add Prior Procedure</button>'+
        '</div>'+
        '<div class="hist-section"><div class="hist-head">Current Active Medications</div>'+
          '<div id="npMedRows"></div>'+
          '<button class="btn-secondary hist-add" id="npAddMedRow" type="button">+ Add Active Medication</button>'+
        '</div>'+
        '<div class="hist-section"><div class="hist-head">Current Values for This Admission</div>'+
          '<p style="font-size:12px;color:var(--ink-dim);margin:0 0 9px;">What a lab drawn <em>today</em> should return. Set these alongside the prior results above so the trend reads correctly \u2014 a case built to show a rising creatinine needs the current value entered here, or today\u2019s result will come back normal and contradict the history. Blank = normal default.</p>'+
          '<div id="npBaselineVals"></div>'+
        '</div>'+
      '</div>'+
      '<div id="npError" style="color:var(--red);font-size:12.5px;margin-bottom:10px;display:none;"></div>'+
      '<div style="display:flex;justify-content:flex-end;gap:9px;">'+
        '<button class="btn-secondary" id="npCancelBtn" type="button">Cancel</button>'+
        '<button class="btn-primary" id="npSaveBtn" type="button">Save Patient</button>'+
      '</div>';

    document.getElementById('npBaselineVals').innerHTML = renderBaselineValueFieldsHtml();
    document.getElementById('npAddLabRow').addEventListener('click', function(){ addLabHistRow(); });
    document.getElementById('npAddImgRow').addEventListener('click', function(){ addImgHistRow(); });
    document.getElementById('npAddProcRow').addEventListener('click', function(){ addProcHistRow(); });
    document.getElementById('npAddMedRow').addEventListener('click', function(){ addMedHistRow(); });

    document.getElementById('npCancelBtn').addEventListener('click', closePatientModal);
    document.getElementById('npSaveBtn').addEventListener('click', function(){
      const errEl = document.getElementById('npError');
      const first = document.getElementById('npFirst').value.trim();
      const last = document.getElementById('npLast').value.trim();
      const dob = document.getElementById('npDob').value;
      const sex = document.getElementById('npSex').value;
      const cc = document.getElementById('npCc').value.trim();
      const hpi = document.getElementById('npHpi').value.trim();
      const assessment = document.getElementById('npAssessment').value.trim();
      const plan = document.getElementById('npPlan').value.trim();
      if (!first || !last || !dob || !cc || !hpi || !assessment || !plan){
        errEl.textContent = 'Please fill in all fields marked with * — name, date of birth, chief complaint, HPI, assessment, and plan.';
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';
      const hist = readPriorRecordsFromForm();
      const f = {
        first: first, last: last, dob: dob, sex: sex,
        room: document.getElementById('npRoom').value.trim(),
        mrn: document.getElementById('npMrn').value.trim(),
        attending: document.getElementById('npAttending').value.trim(),
        team: document.getElementById('npTeam').value.trim(),
        codeStatus: document.getElementById('npCodeStatus').value,
        chiefComplaint: cc,
        allergies: splitList(document.getElementById('npAllergies').value),
        problemList: splitList(document.getElementById('npProblems').value),
        homeMeds: splitList(document.getElementById('npHomeMeds').value),
        vitals: {
          temp: document.getElementById('npTemp').value,
          hr: document.getElementById('npHr').value,
          bp: document.getElementById('npBp').value,
          rr: document.getElementById('npRr').value,
          spo2: document.getElementById('npSpo2').value,
          pain: document.getElementById('npPain').value
        },
        priorRecords: hist.priorRecords,
        activeMeds: hist.activeMeds,
        labProfile: readBaselineValuesFromForm(),
        seedHP: {
          hpi: hpi,
          pmh: document.getElementById('npPmh').value.trim(),
          psh: document.getElementById('npPsh').value.trim(),
          fhx: document.getElementById('npFhx').value.trim(),
          shx: document.getElementById('npShx').value.trim(),
          ros: document.getElementById('npRos').value.trim(),
          pe: document.getElementById('npPe').value.trim(),
          studies: document.getElementById('npStudies').value.trim(),
          assessment: assessment,
          plan: plan
        }
      };
      addCustomPatient(buildCustomPatientFromFields(f));
      closePatientModal();
      renderPatientList();
    });
  }

  /* Unknown panel ids or component keys in imported JSON would otherwise be
     dropped silently, producing a normal-looking result the author didn't
     intend. Surface them instead. */
  function validatePriorRecords(parsed){
    const problems = [];
    const pr = parsed.priorRecords || {};
    (pr.labs||[]).forEach(function(e, i){
      const panel = LAB_PANELS[e.panelId];
      if (!panel){ problems.push('priorRecords.labs['+i+']: unknown panelId "'+e.panelId+'"'); return; }
      if (!e.date || parseHistoryDate(e.date)===null) problems.push('priorRecords.labs['+i+']: missing or unreadable date (use YYYY-MM-DD)');
      if (panel.kind==='numeric'){
        const valid = {};
        panel.components.forEach(function(c){ valid[c.id]=true; });
        Object.keys(e.values||{}).forEach(function(k){
          if (!valid[k]) problems.push('priorRecords.labs['+i+']: "'+k+'" is not a component of '+panel.label+' (valid: '+panel.components.map(function(c){return c.id;}).join(', ')+')');
        });
      }
    });
    (pr.imaging||[]).forEach(function(e, i){
      if (!IMAGING_TYPES[e.typeId]) problems.push('priorRecords.imaging['+i+']: unknown typeId "'+e.typeId+'"');
      if (!e.date || parseHistoryDate(e.date)===null) problems.push('priorRecords.imaging['+i+']: missing or unreadable date');
    });
    (pr.procedures||[]).forEach(function(e, i){
      if (!PROCEDURES[e.procId]) problems.push('priorRecords.procedures['+i+']: unknown procId "'+e.procId+'"');
      if (!e.date || parseHistoryDate(e.date)===null) problems.push('priorRecords.procedures['+i+']: missing or unreadable date');
    });
    const validComps = {};
    Object.keys(LAB_PANELS).forEach(function(pid){
      if (LAB_PANELS[pid].kind==='numeric') LAB_PANELS[pid].components.forEach(function(c){ validComps[c.id]=true; });
    });
    Object.keys(parsed.labProfile||{}).forEach(function(k){
      if (!validComps[k]) problems.push('labProfile: "'+k+'" is not a known lab component id');
    });
    return problems;
  }

  function renderPatientImportForm(){
    psubImport.innerHTML =
      '<div class="card"><h3>Import Patient from JSON</h3>'+
        '<p style="font-size:12.5px;color:var(--ink-dim);line-height:1.6;margin-top:0;">Paste a patient case object matching the schema below \u2014 useful if you\u2019ve drafted a case elsewhere and want to bring it in directly. At minimum, include <code>first</code>, <code>last</code>, <code>dob</code>, <code>sex</code>, <code>chiefComplaint</code>, and a <code>seedHP</code> with <code>hpi</code>, <code>assessment</code>, and <code>plan</code> \u2014 everything else has a reasonable default. Optional <code>priorRecords</code> (labs / imaging / procedures), <code>activeMeds</code>, and <code>labProfile</code> blocks seed the chart with dated outside results \u2014 load the example template to see the schema. Lab values are keyed by component id (e.g. <code>cr</code> for creatinine); anything unrecognized is reported rather than ignored.</p>'+
        '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;"><button class="btn-secondary" id="npLoadTemplateBtn" type="button">Load Example Template</button></div>'+
        '<div class="field"><textarea id="npJsonInput" rows="14" style="font-family:var(--font-data);font-size:12px;" placeholder="Paste patient JSON here\u2026"></textarea></div>'+
        '<div id="npJsonError" style="color:var(--red);font-size:12.5px;margin-bottom:10px;display:none;"></div>'+
        '<div style="display:flex;justify-content:flex-end;gap:9px;">'+
          '<button class="btn-secondary" id="npJsonCancelBtn" type="button">Cancel</button>'+
          '<button class="btn-primary" id="npJsonAddBtn" type="button">Add Patient from JSON</button>'+
        '</div>'+
      '</div>';

    document.getElementById('npLoadTemplateBtn').addEventListener('click', function(){
      document.getElementById('npJsonInput').value = JSON.stringify(PATIENT_JSON_TEMPLATE, null, 2);
    });
    document.getElementById('npJsonCancelBtn').addEventListener('click', closePatientModal);
    document.getElementById('npJsonAddBtn').addEventListener('click', function(){
      const errEl = document.getElementById('npJsonError');
      const raw = document.getElementById('npJsonInput').value;
      let parsed;
      try{ parsed = JSON.parse(raw); }
      catch(e){ errEl.textContent = 'That isn\u2019t valid JSON: '+e.message; errEl.style.display='block'; return; }
      if (!parsed.first || !parsed.last || !parsed.dob || !parsed.sex || !parsed.chiefComplaint ||
          !parsed.seedHP || !parsed.seedHP.hpi || !parsed.seedHP.assessment || !parsed.seedHP.plan){
        errEl.textContent = 'Missing a required field. At minimum, include first, last, dob, sex, chiefComplaint, and seedHP.hpi / seedHP.assessment / seedHP.plan.';
        errEl.style.display = 'block';
        return;
      }
      const problems = validatePriorRecords(parsed);
      if (problems.length){
        errEl.innerHTML = 'This case imported with problems that would silently change the results:<br>\u2022 '+
          problems.map(escapeHtml).join('<br>\u2022 ');
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';
      addCustomPatient(buildCustomPatientFromFields(parsed));
      closePatientModal();
      renderPatientList();
    });
  }

  document.getElementById('addPatientBtn').addEventListener('click', function(){
    renderPatientBuilderForm();
    renderPatientImportForm();
    setPatientSub('build');
    patientModal.classList.add('open');
  });

  /* ---------------------------------------------------------------
     RENDER: Chart shell (banner + tabs)
  --------------------------------------------------------------- */
  const viewList = document.getElementById('viewList');
  const viewChart = document.getElementById('viewChart');
  const bannerName = document.getElementById('bannerName');
  const bannerMeta = document.getElementById('bannerMeta');
  const bannerChips = document.getElementById('bannerChips');
  const tabBtns = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
  const panelOverview     = document.getElementById('panelOverview');
  const panelNotes        = document.getElementById('panelNotes');
  const panelOrders       = document.getElementById('panelOrders');
  const panelMedications  = document.getElementById('panelMedications');
  const panelVitals       = document.getElementById('panelVitals');
  const panelIO           = document.getElementById('panelIO');
  const panelFacilitator  = document.getElementById('panelFacilitator');

  function showView(id){
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function(v){ v.classList.toggle('active', v.id===id); });
  }

  const sbAllergyBand = document.getElementById('sbAllergyBand');
  const sbProblemList = document.getElementById('sbProblemList');
  function updateProblemList(p){
    const list = (p.problemList && p.problemList.length) ? p.problemList : null;
    sbProblemList.innerHTML = list
      ? list.map(function(pr){ return '<li>'+escapeHtml(pr)+'</li>'; }).join('')
      : '<li class="sb-empty">No active problems documented</li>';
  }
  function updateAllergyBand(p){
    const hasAllergy = !(p.allergies.length===1 && p.allergies[0]==='NKDA');
    if (hasAllergy){
      sbAllergyBand.textContent = '⚠ Allergy: '+p.allergies.join(', ');
      sbAllergyBand.classList.add('show');
    } else {
      sbAllergyBand.textContent = '';
      sbAllergyBand.classList.remove('show');
    }
  }

  function openChart(patientId){
    STATE.currentPatientId = patientId;
    const p = PATIENT_BY_ID[patientId];
    const age = calcAge(p.dob);
    bannerName.textContent = p.last+', '+p.first;
    bannerMeta.textContent = 'MRN '+p.mrn+'  ·  DOB '+p.dob+' (age '+age+')  ·  '+p.sex+'  ·  Room '+p.room+'  ·  Admitted '+fmtDate(p.admitAt);
    updateAllergyBand(p);
    updateProblemList(p);

    const allergyChip = (p.allergies.length===1 && p.allergies[0]==='NKDA')
      ? '<span class="chip ok">Allergies: NKDA</span>'
      : '<span class="chip warn">Allergies: '+escapeHtml(p.allergies.join(', '))+'</span>';
    const codeChip = p.codeStatus==='Full Code'
      ? '<span class="chip ok">'+escapeHtml(p.codeStatus)+'</span>'
      : '<span class="chip warn">'+escapeHtml(p.codeStatus)+'</span>';
    const teamChip = '<span class="chip attn">'+escapeHtml(p.attending)+' · '+escapeHtml(p.team)+'</span>';
    bannerChips.innerHTML = codeChip+allergyChip+teamChip;

    setActiveTab('overview');
    showView('viewChart');
  }

  document.getElementById('backToListBtn').addEventListener('click', function(){
    STATE.currentPatientId = null;
    showView('viewList');
    renderPatientList();
  });

  document.getElementById('perPatientResetBtn').addEventListener('click', function(){
    const p = PATIENT_BY_ID[STATE.currentPatientId];
    if (!p) return;
    const ok = window.confirm('Reset '+p.first+' '+p.last+'\u2019s chart? This deletes every note and order you\u2019ve added for this patient and restores the original seeded H&P. This cannot be undone.');
    if (!ok) return;
    resetPatientData(p.id);
    setActiveTab(STATE.currentTab);
  });

  /* ---------------------------------------------------------------
     EDIT DEMOGRAPHICS — works for both built-in and custom patients.
     Built-in edits are stored in STATE.patientOverrides so the source
     array is never mutated; custom patient objects are updated in-place.
  --------------------------------------------------------------- */
  const editDemoModal = document.getElementById('editDemoModal');
  const editDemoBody  = document.getElementById('editDemoBody');
  const editDemoFoot  = document.getElementById('editDemoFoot');
  function closeEditDemo(){ editDemoModal.classList.remove('open'); }
  document.getElementById('editDemoClose').addEventListener('click', closeEditDemo);
  editDemoModal.addEventListener('click', function(e){ if (e.target===editDemoModal) closeEditDemo(); });

  function openEditDemo(p){
    const routes = ['PO','IV','IM','SC','SL','PR','Topical','Inhaled','Other'];
    const codeOpts = ['Full Code','DNR','DNR/DNI'].map(function(v){
      return '<option'+(p.codeStatus===v?' selected':'')+'>'+v+'</option>';
    }).join('');
    const sexOpts = ['F','M'].map(function(v){
      return '<option value="'+v+'"'+(p.sex===v?' selected':'')+'>'+v+'</option>';
    }).join('');
    editDemoBody.innerHTML =
      '<div class="card"><h3>Identifying Information</h3>'+
        '<div class="field-row">'+
          '<div class="field"><label>First Name</label><input type="text" id="edFirst" value="'+escapeHtml(p.first)+'"></div>'+
          '<div class="field"><label>Last Name</label><input type="text" id="edLast" value="'+escapeHtml(p.last)+'"></div>'+
        '</div>'+
        '<div class="field-row">'+
          '<div class="field"><label>Date of Birth</label><input type="date" id="edDob" value="'+escapeHtml(p.dob)+'"></div>'+
          '<div class="field"><label>Sex</label><select id="edSex">'+sexOpts+'</select></div>'+
        '</div>'+
        '<div class="field-row">'+
          '<div class="field"><label>Room</label><input type="text" id="edRoom" value="'+escapeHtml(p.room)+'"></div>'+
          '<div class="field"><label>MRN</label><input type="text" id="edMrn" value="'+escapeHtml(p.mrn)+'"></div>'+
        '</div>'+
        '<div class="field-row">'+
          '<div class="field"><label>Attending</label><input type="text" id="edAttending" value="'+escapeHtml(p.attending)+'"></div>'+
          '<div class="field"><label>Team</label><input type="text" id="edTeam" value="'+escapeHtml(p.team)+'"></div>'+
        '</div>'+
        '<div class="field"><label>Code Status</label><select id="edCode">'+codeOpts+'</select></div>'+
      '</div>'+
      '<div class="card"><h3>Allergies &amp; Problem List</h3>'+
        '<div class="field"><label>Allergies <span style="font-weight:400;color:var(--ink-faint)">(comma-separated, or NKDA)</span></label>'+
          '<input type="text" id="edAllergies" value="'+escapeHtml((p.allergies||[]).join(', '))+'"></div>'+
        '<div class="field"><label>Problem List <span style="font-weight:400;color:var(--ink-faint)">(comma-separated)</span></label>'+
          '<input type="text" id="edProblems" value="'+escapeHtml((p.problemList||[]).join(', '))+'"></div>'+
        '<div class="field"><label>Home / Active Medications <span style="font-weight:400;color:var(--ink-faint)">(comma-separated)</span></label>'+
          '<input type="text" id="edHomeMeds" value="'+escapeHtml((p.homeMeds||[]).join(', '))+'"></div>'+
      '</div>'+
      '<div class="card"><h3>Admission Vitals</h3>'+
        '<div class="field-row" style="grid-template-columns:repeat(6,1fr);gap:8px;">'+
          '<div class="field"><label>Temp (&deg;F)</label><input type="text" id="edTemp" value="'+escapeHtml(String(p.vitals&&p.vitals.temp||''))+'"></div>'+
          '<div class="field"><label>HR</label><input type="text" id="edHr" value="'+escapeHtml(String(p.vitals&&p.vitals.hr||''))+'"></div>'+
          '<div class="field"><label>BP</label><input type="text" id="edBp" value="'+escapeHtml(String(p.vitals&&p.vitals.bp||''))+'"></div>'+
          '<div class="field"><label>RR</label><input type="text" id="edRr" value="'+escapeHtml(String(p.vitals&&p.vitals.rr||''))+'"></div>'+
          '<div class="field"><label>SpO2 (%)</label><input type="text" id="edSpo2" value="'+escapeHtml(String(p.vitals&&p.vitals.spo2||''))+'"></div>'+
          '<div class="field"><label>Pain</label><input type="text" id="edPain" value="'+escapeHtml(String(p.vitals&&p.vitals.pain||''))+'"></div>'+
        '</div>'+
      '</div>';
    editDemoFoot.innerHTML = '<button class="btn-secondary" id="edCancel" type="button">Cancel</button>'+
      '<button class="btn-primary" id="edSave" type="button">Save Changes</button>';
    document.getElementById('edCancel').addEventListener('click', closeEditDemo);
    document.getElementById('edSave').addEventListener('click', function(){
      const allergiesRaw = document.getElementById('edAllergies').value.trim();
      const allergies = allergiesRaw ? splitList(allergiesRaw) : ['NKDA'];
      const updates = {
        first:       document.getElementById('edFirst').value.trim() || p.first,
        last:        document.getElementById('edLast').value.trim()  || p.last,
        dob:         document.getElementById('edDob').value          || p.dob,
        sex:         document.getElementById('edSex').value,
        room:        document.getElementById('edRoom').value.trim()  || p.room,
        mrn:         document.getElementById('edMrn').value.trim()   || p.mrn,
        attending:   document.getElementById('edAttending').value.trim() || p.attending,
        team:        document.getElementById('edTeam').value.trim()  || p.team,
        codeStatus:  document.getElementById('edCode').value,
        allergies:   allergies,
        problemList: splitList(document.getElementById('edProblems').value),
        homeMeds:    splitList(document.getElementById('edHomeMeds').value),
        vitals: {
          temp: numOr(document.getElementById('edTemp').value,  p.vitals&&p.vitals.temp  || 98.6),
          hr:   numOr(document.getElementById('edHr').value,    p.vitals&&p.vitals.hr    || 80),
          bp:   document.getElementById('edBp').value.trim() || (p.vitals&&p.vitals.bp  || '120/80'),
          rr:   numOr(document.getElementById('edRr').value,    p.vitals&&p.vitals.rr    || 16),
          spo2: numOr(document.getElementById('edSpo2').value,  p.vitals&&p.vitals.spo2  || 98),
          pain: numOr(document.getElementById('edPain').value,  p.vitals&&p.vitals.pain  || 0)
        }
      };
      if (p.custom){
        // custom: update in-place in customPatients array
        const idx = STATE.customPatients.findIndex(function(c){ return c.id===p.id; });
        if (idx>-1) Object.assign(STATE.customPatients[idx], updates);
      } else {
        // built-in: store override, never touch PATIENTS
        STATE.patientOverrides[p.id] = updates;
      }
      reindexPatients();
      saveStoredState();
      // refresh banner and list
      const updated = PATIENT_BY_ID[p.id];
      if (updated){
        const age = calcAge(updated.dob);
        bannerName.textContent = updated.last+', '+updated.first;
        bannerMeta.textContent = 'MRN '+updated.mrn+'  \u00b7  DOB '+updated.dob+' (age '+age+')  \u00b7  '+updated.sex+'  \u00b7  Room '+updated.room+'  \u00b7  Admitted '+fmtDate(updated.admitAt);
        updateAllergyBand(updated);
        updateProblemList(updated);
        const allergyChip = (updated.allergies.length===1 && updated.allergies[0]==='NKDA')
          ? '<span class="chip ok">Allergies: NKDA</span>'
          : '<span class="chip warn">Allergies: '+escapeHtml(updated.allergies.join(', '))+'</span>';
        const codeChip = updated.codeStatus==='Full Code'
          ? '<span class="chip ok">'+escapeHtml(updated.codeStatus)+'</span>'
          : '<span class="chip warn">'+escapeHtml(updated.codeStatus)+'</span>';
        const teamChip = '<span class="chip attn">'+escapeHtml(updated.attending)+' \u00b7 '+escapeHtml(updated.team)+'</span>';
        bannerChips.innerHTML = codeChip+allergyChip+teamChip;
        if (STATE.currentTab==='overview') renderOverviewPanel(updated);
      }
      renderPatientList();
      closeEditDemo();
    });
    editDemoModal.classList.add('open');
  }

  document.getElementById('editPatientBtn').addEventListener('click', function(){
    const p = PATIENT_BY_ID[STATE.currentPatientId];
    if (p) openEditDemo(p);
  });

  /* DELETE PATIENT -- built-in goes to deletedPatientIds, custom calls removeCustomPatient */
  document.getElementById('deletePatientBtn').addEventListener('click', function(){
    const p = PATIENT_BY_ID[STATE.currentPatientId];
    if (!p) return;
    const ok = window.confirm('Delete '+p.first+' '+p.last+'? This removes the patient from the list and permanently deletes all of their notes and orders in this browser. This cannot be undone.');
    if (!ok) return;
    if (p.custom){
      removeCustomPatient(p.id);
    } else {
      STATE.deletedPatientIds = (STATE.deletedPatientIds||[]).concat([p.id]);
      delete STATE.notes[p.id];
      delete STATE.orders[p.id];
      delete STATE.orderCart[p.id];
      delete STATE.labOverrides[p.id];
      delete STATE.patientOverrides[p.id];
      saveStoredState();
    }
    reindexPatients();
    STATE.currentPatientId = null;
    showView('viewList');
    renderPatientList();
  });

  function setActiveTab(tab){
    STATE.currentTab = tab;
    tabBtns.forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-tab')===tab); });
    panelOverview.classList.toggle('active',    tab==='overview');
    panelNotes.classList.toggle('active',       tab==='notes');
    panelOrders.classList.toggle('active',      tab==='orders');
    panelMedications.classList.toggle('active', tab==='medications');
    panelVitals.classList.toggle('active',      tab==='vitals');
    panelIO.classList.toggle('active',          tab==='io');
    panelFacilitator.classList.toggle('active', tab==='facilitator');
    const p = PATIENT_BY_ID[STATE.currentPatientId];
    if (!p) return;
    if (tab==='overview')    renderOverviewPanel(p);
    if (tab==='notes')       renderNotesPanel(p);
    if (tab==='orders')      renderOrdersPanel(p);
    if (tab==='medications') renderMedicationsPanel(p);
    if (tab==='vitals')      renderVitalsPanel(p);
    if (tab==='io')          renderIOPanel(p);
    if (tab==='facilitator') renderFacilitatorPanel(p);
  }
  tabBtns.forEach(function(b){ b.addEventListener('click', function(){ setActiveTab(b.getAttribute('data-tab')); }); });

  /* ---------------------------------------------------------------
     RENDER: Overview tab
  --------------------------------------------------------------- */
  function renderOverviewPanel(p){
    const age = calcAge(p.dob);
    const problems = (p.problemList&&p.problemList.length) ? p.problemList.map(function(x){return '<li>'+escapeHtml(x)+'</li>';}).join('') : '<li>None on file.</li>';
    const activeMedList = (p.activeMeds||[]).map(function(m){
      const line = [m.drug, m.dose, m.route, m.frequency].filter(function(x){ return x && String(x).trim(); }).join(' ');
      const detail = [m.indication ? 'for '+m.indication : '', m.startDate ? 'since '+m.startDate : ''].filter(Boolean).join(' \u00b7 ');
      return '<li>'+escapeHtml(line)+(detail ? '<span class="med-detail">'+escapeHtml(detail)+'</span>' : '')+'</li>';
    }).join('');
    const homeMedList = (p.homeMeds&&p.homeMeds.length) ? p.homeMeds.map(function(x){return '<li>'+escapeHtml(x)+'</li>';}).join('') : '';
    const meds = (activeMedList + homeMedList) || '<li>None on file.</li>';
    const v = p.vitals;
    panelOverview.innerHTML =
      '<div class="two-col">'+
        '<div class="card"><h3>Demographics &amp; Admission</h3>'+
          '<div class="kv"><span class="k">MRN</span><span>'+escapeHtml(p.mrn)+'</span></div>'+
          '<div class="kv"><span class="k">DOB / Age</span><span>'+escapeHtml(p.dob)+' ('+age+' y)</span></div>'+
          '<div class="kv"><span class="k">Sex</span><span>'+p.sex+'</span></div>'+
          '<div class="kv"><span class="k">Room</span><span>'+escapeHtml(p.room)+'</span></div>'+
          '<div class="kv"><span class="k">Admitted</span><span>'+fmtDateTime(p.admitAt)+'</span></div>'+
          '<div class="kv"><span class="k">Attending</span><span>'+escapeHtml(p.attending)+'</span></div>'+
          '<div class="kv"><span class="k">Team</span><span>'+escapeHtml(p.team)+'</span></div>'+
          '<div class="kv"><span class="k">Code Status</span><span>'+escapeHtml(p.codeStatus)+'</span></div>'+
        '</div>'+
        '<div class="card"><h3>Most Recent Vitals</h3>'+
          '<div class="kv"><span class="k">Temp</span><span>'+v.temp+'\u00b0F</span></div>'+
          '<div class="kv"><span class="k">Heart Rate</span><span>'+v.hr+' bpm</span></div>'+
          '<div class="kv"><span class="k">Blood Pressure</span><span>'+v.bp+' mmHg</span></div>'+
          '<div class="kv"><span class="k">Resp. Rate</span><span>'+v.rr+' /min</span></div>'+
          '<div class="kv"><span class="k">SpO2</span><span>'+v.spo2+'%</span></div>'+
          '<div class="kv"><span class="k">Pain</span><span>'+v.pain+' / 10</span></div>'+
        '</div>'+
      '</div>'+
      '<div class="two-col">'+
        '<div class="card"><h3>Active Problem List</h3><ul class="plainlist">'+problems+'</ul></div>'+
        '<div class="card"><h3>Active &amp; Home Medications</h3><ul class="plainlist">'+meds+'</ul></div>'+
      '</div>'+
      '<div class="card"><h3>Chief Complaint</h3><div style="font-size:13px;">'+escapeHtml(p.chiefComplaint)+'</div></div>';
  }

  /* ---------------------------------------------------------------
     RENDER: Notes tab + note editor/viewer modal
  --------------------------------------------------------------- */
  const noteModal = document.getElementById('noteModal');
  const noteModalTitle = document.getElementById('noteModalTitle');
  const noteModalBody = document.getElementById('noteModalBody');
  const noteModalFoot = document.getElementById('noteModalFoot');

  function closeNoteModal(){ noteModal.classList.remove('open'); noteModalBody.innerHTML=''; noteModalFoot.innerHTML=''; }
  document.getElementById('noteModalClose').addEventListener('click', closeNoteModal);
  noteModal.addEventListener('click', function(e){ if (e.target===noteModal) closeNoteModal(); });

  function renderNotesPanel(p){
    const notes = (STATE.notes[p.id]||[]).slice().sort(function(a,b){ return b.timestamp-a.timestamp; });
    const rows = notes.map(function(n){
      const tpl = NOTE_TEMPLATES[n.type];
      return '<div class="note-row" data-nid="'+n.id+'">'+
        '<span class="note-type-tag '+n.type+'">'+tpl.tag+'</span>'+
        '<div class="note-row-mid"><div class="note-row-title">'+escapeHtml(noteTitle(n))+'</div>'+
        '<div class="note-row-meta">by '+escapeHtml(n.author||'Unspecified')+'  ·  '+fmtDateTime(n.timestamp)+'</div></div>'+
        '</div>';
    }).join('') || '<div class="empty-state">No notes yet for this patient.</div>';

    panelNotes.innerHTML =
      '<div class="notes-toolbar">'+
        '<div class="newnote-menu">'+
          '<button class="btn-primary" id="newNoteBtn" type="button">+ New Note</button>'+
          '<div class="newnote-list" id="newNoteList">'+
            '<button data-type="progress" type="button">Progress Note (SOAP)</button>'+
            '<button data-type="hp" type="button">History &amp; Physical</button>'+
            '<button data-type="consult" type="button">Consultation</button>'+
            '<button data-type="procedure_note" type="button">Procedure Note</button>'+
            '<button data-type="discharge" type="button">Discharge Summary</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div id="noteRows">'+rows+'</div>';

    const newNoteBtn = document.getElementById('newNoteBtn');
    const newNoteList = document.getElementById('newNoteList');
    newNoteBtn.addEventListener('click', function(e){ e.stopPropagation(); newNoteList.classList.toggle('open'); });
    Array.prototype.forEach.call(newNoteList.querySelectorAll('button'), function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        newNoteList.classList.remove('open');
        openNoteEditor(p, btn.getAttribute('data-type'));
      });
    });
    Array.prototype.forEach.call(panelNotes.querySelectorAll('.note-row'), function(row){
      row.addEventListener('click', function(){
        const n = (STATE.notes[p.id]||[]).find(function(x){ return x.id===row.getAttribute('data-nid'); });
        if (n) openNoteViewer(p, n);
      });
    });
  }

  function defaultFieldValue(type, key, p){
    if (type==='discharge'){
      if (key==='admitDate') return fmtDate(p.admitAt);
      if (key==='dischargeDate') return fmtDate(Date.now());
      if (key==='admitDx') return p.chiefComplaint;
    }
    return '';
  }

  function openNoteEditor(p, type){
    const tpl = NOTE_TEMPLATES[type];
    noteModalTitle.textContent = 'New '+tpl.label;
    noteModalBody.innerHTML = tpl.fields.map(function(f){
      return '<div class="field"><label>'+escapeHtml(f.label)+'</label>'+
        '<textarea data-key="'+f.key+'" rows="'+(f.key==='hpi'||f.key==='course'||f.key==='plan'?4:2)+'">'+escapeHtml(defaultFieldValue(type,f.key,p))+'</textarea></div>';
    }).join('');
    noteModalFoot.innerHTML =
      '<button class="btn-secondary" id="noteCancelBtn" type="button">Cancel</button>'+
      '<button class="btn-primary" id="noteSaveBtn" type="button">Save Note</button>';
    noteModal.classList.add('open');
    document.getElementById('noteCancelBtn').addEventListener('click', closeNoteModal);
    document.getElementById('noteSaveBtn').addEventListener('click', function(){
      const fields = {};
      Array.prototype.forEach.call(noteModalBody.querySelectorAll('textarea'), function(ta){
        fields[ta.getAttribute('data-key')] = ta.value.trim();
      });
      const note = {
        id: uid('note'), type: type,
        author: STATE.clinicianName || 'Unnamed Student',
        timestamp: Date.now(), fields: fields
      };
      if (!STATE.notes[p.id]) STATE.notes[p.id]=[];
      STATE.notes[p.id].push(note);
      saveStoredState();
      closeNoteModal();
      renderNotesPanel(p);
    });
  }

  function openNoteViewer(p, note){
    const tpl = NOTE_TEMPLATES[note.type];
    noteModalTitle.textContent = tpl.label+' — '+p.first+' '+p.last;
    noteModalBody.innerHTML =
      '<div class="note-row-meta" style="margin-bottom:10px;">Author: '+escapeHtml(note.author||'Unspecified')+'  ·  '+fmtDateTime(note.timestamp)+'</div>'+
      '<div class="note-view-content">'+compileNoteHtml(note)+'</div>';
    noteModalFoot.innerHTML =
      '<button class="btn-secondary" id="notePrintBtn" type="button">Print</button>'+
      '<button class="btn-primary" id="noteCloseBtn" type="button">Close</button>';
    noteModal.classList.add('open');
    document.getElementById('noteCloseBtn').addEventListener('click', closeNoteModal);
    document.getElementById('notePrintBtn').addEventListener('click', function(){ window.print(); });
  }

  /* ---------------------------------------------------------------
     RENDER: Orders & Results tab
  --------------------------------------------------------------- */
  function renderLabLinesHtml(lines){
    return lines.map(function(l){
      const flagClass = l.flag==='C' ? 'C' : (l.flag||'');
      const flagText = l.flag==='C' ? 'CRIT' : (l.flag||'');
      return '<div class="lab-line"><span class="lname">'+escapeHtml(l.label)+'</span>'+
        '<span class="lval">'+l.value+' '+escapeHtml(l.unit)+'</span>'+
        '<span class="lflag '+flagClass+'">'+flagText+'</span>'+
        '<span class="lrange">ref '+l.range+'</span></div>';
    }).join('');
  }

  /* Order picker: one dropdown per order domain, categories rendered as
     <optgroup> so the catalog stays organized while the control stays compact. */
  function renderOrderSelectHtml(groups, prefix, fieldLabel, placeholder){
    const optionsHtml = groups.map(function(g){
      return '<optgroup label="'+escapeHtml(g.category)+'">'+
        g.items.map(function(it){
          return '<option value="'+escapeHtml(it.id)+'">'+escapeHtml(it.label)+'</option>';
        }).join('')+
        '</optgroup>';
    }).join('');
    return '<div class="order-picker">'+
        '<div class="order-picker-field">'+
          '<label for="sel_'+prefix+'">'+escapeHtml(fieldLabel)+'</label>'+
          '<select class="order-select" id="sel_'+prefix+'" data-prefix="'+prefix+'">'+
            '<option value="">'+escapeHtml(placeholder)+'</option>'+
            optionsHtml+
          '</select>'+
        '</div>'+
        '<button class="btn-secondary order-add-btn" type="button" data-add="'+prefix+'" disabled>Add to Order List</button>'+
      '</div>'+
      '<div class="order-picker-hint" id="hint_'+prefix+'"></div>';
  }

  /* Staged orders live in memory per patient until the student signs them. */
  function getOrderCart(patientId){
    if (!STATE.orderCart[patientId]) STATE.orderCart[patientId] = [];
    return STATE.orderCart[patientId];
  }

  const ORDER_DOMAIN_LABEL = { lab:'Lab', img:'Imaging', proc:'Procedure', med:'Med' };

  function renderOrderCartHtml(patientId){
    const cart = getOrderCart(patientId);
    if (!cart.length) return '<div class="order-cart-empty">No orders staged yet. Choose items from the dropdowns above, then sign them below.</div>';
    return cart.map(function(entry, i){
      return '<div class="order-cart-item">'+
        '<span class="order-cart-domain">'+escapeHtml(ORDER_DOMAIN_LABEL[entry.domain]||entry.domain)+'</span>'+
        '<span class="order-cart-label">'+escapeHtml(entry.label)+'</span>'+
        '<button class="order-cart-remove" type="button" data-cart-remove="'+i+'" aria-label="Remove '+escapeHtml(entry.label)+' from order list">Remove</button>'+
        '</div>';
    }).join('');
  }

  function renderOrdersPanel(p){
    panelOrders.innerHTML =
      '<div class="subtab-strip">'+
        '<button class="subtab-btn" data-sub="place" type="button">Place Orders</button>'+
        '<button class="subtab-btn" data-sub="history" type="button">Order History &amp; Results</button>'+
        '<button class="subtab-btn" data-sub="trends" type="button">Trends</button>'+
      '</div>'+
      '<div class="subtab-panel" id="subPlace">'+
        '<div class="card"><h3>Laboratory</h3>'+renderOrderSelectHtml(buildLabOrderGroups(),'lab','Laboratory order','— Select a laboratory test —')+'</div>'+
        '<div class="card"><h3>Imaging</h3>'+renderOrderSelectHtml(buildImagingOrderGroups(),'img','Imaging / diagnostic study','— Select an imaging study —')+'</div>'+
        '<div class="card"><h3>Procedures</h3>'+renderOrderSelectHtml(buildProcedureOrderGroups(),'proc','Procedure','— Select a procedure —')+'</div>'+
        '<div class="card"><h3>Diet &amp; Nutrition</h3>'+renderOrderSelectHtml(buildDietOrderGroups(),'diet','Diet order','— Select a diet / nutrition order —')+'</div>'+
        '<div class="card"><h3>Medications</h3>'+renderOrderSelectHtml(buildMedicationOrderGroups(),'med','Medication','— Select a medication —')+
          '<div style="border-top:1px solid var(--border);margin-top:14px;padding-top:12px;">'+
            '<div style="font-size:11.5px;font-weight:700;color:var(--teal-dark);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Custom Medication Order</div>'+
            '<div class="field-row">'+
              '<div class="field"><label>Medication</label><input type="text" id="customMedDrug" placeholder="e.g., Ceftriaxone"></div>'+
              '<div class="field"><label>Dose</label><input type="text" id="customMedDose" placeholder="e.g., 1 g"></div>'+
            '</div>'+
            '<div class="field-row">'+
              '<div class="field"><label>Route</label><select id="customMedRoute">'+
                ['PO','IV','IM','SC','SL','PR','Topical','Inhaled','Other'].map(function(r){ return '<option value="'+r+'">'+r+'</option>'; }).join('')+
              '</select></div>'+
              '<div class="field"><label>Frequency</label><select id="customMedFreq">'+
                ['Once / STAT','Daily','BID','TID','QID','Q4H','Q6H','Q8H','Q12H','PRN','Continuous infusion'].map(function(f){ return '<option value="'+f+'">'+f+'</option>'; }).join('')+
              '</select></div>'+
            '</div>'+
            '<div class="field"><label>PRN Indication (optional)</label><input type="text" id="customMedPrnIndication" placeholder="e.g., pain, nausea — leave blank if scheduled"></div>'+
            '<div id="customMedError" style="color:var(--red);font-size:12px;margin-bottom:6px;display:none;"></div>'+
            '<div style="display:flex;justify-content:flex-end;"><button class="btn-secondary" id="addCustomMedBtn" type="button">Add Custom Medication to Order List</button></div>'+
          '</div>'+
        '</div>'+
        '<div class="card order-cart"><h4>Pending Order List (not yet signed)</h4>'+
          '<div id="orderCartList" aria-live="polite">'+renderOrderCartHtml(p.id)+'</div>'+
        '</div>'+
        '<div class="order-submit-row"><span class="sel-count" id="selCount">0 staged</span><button class="btn-primary" id="placeOrdersBtn" disabled type="button">Sign &amp; Place Orders</button></div>'+
      '</div>'+
      '<div class="subtab-panel" id="subHistory"></div>'+
      '<div class="subtab-panel" id="subTrends"></div>';

    const subBtns = Array.prototype.slice.call(panelOrders.querySelectorAll('.subtab-btn'));
    const subPlace = document.getElementById('subPlace');
    const subHistory = document.getElementById('subHistory');
    const subTrends = document.getElementById('subTrends');
    function setSub(sub){
      STATE.ordersSubTab = sub;
      subBtns.forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-sub')===sub); });
      subPlace.classList.toggle('active', sub==='place');
      subHistory.classList.toggle('active', sub==='history');
      subTrends.classList.toggle('active', sub==='trends');
      if (sub==='history') renderOrderHistory(p);
      if (sub==='trends') renderTrendsPanel(p);
    }
    subBtns.forEach(function(b){ b.addEventListener('click', function(){ setSub(b.getAttribute('data-sub')); }); });
    setSub(STATE.ordersSubTab||'place');

    const selCountEl = document.getElementById('selCount');
    const placeBtn = document.getElementById('placeOrdersBtn');
    const cartListEl = document.getElementById('orderCartList');
    const CATALOG_BY_PREFIX = {
      lab:  buildLabOrderGroups(),
      img:  buildImagingOrderGroups(),
      proc: buildProcedureOrderGroups(),
      diet: buildDietOrderGroups(),
      med:  buildMedicationOrderGroups()
    };
    const PLACE_CATEGORY = { lab:'lab', img:'imaging', proc:'procedure', diet:'diet', med:'medication' };

    function findCatalogItem(prefix, id){
      const groups = CATALOG_BY_PREFIX[prefix] || [];
      for (let i=0;i<groups.length;i++){
        const items = groups[i].items;
        for (let j=0;j<items.length;j++){ if (items[j].id===id) return items[j]; }
      }
      return null;
    }
    function setHint(prefix, msg, warn){
      const el = document.getElementById('hint_'+prefix);
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('warn', !!warn);
    }
    function refreshCart(){
      const cart = getOrderCart(p.id);
      cartListEl.innerHTML = renderOrderCartHtml(p.id);
      Array.prototype.slice.call(cartListEl.querySelectorAll('[data-cart-remove]')).forEach(function(btn){
        btn.addEventListener('click', function(){
          const idx = parseInt(btn.getAttribute('data-cart-remove'),10);
          cart.splice(idx,1);
          refreshCart();
        });
      });
      selCountEl.textContent = cart.length+' staged';
      placeBtn.disabled = cart.length===0;
    }

    Array.prototype.slice.call(panelOrders.querySelectorAll('.order-select')).forEach(function(sel){
      const prefix = sel.getAttribute('data-prefix');
      const addBtn = panelOrders.querySelector('[data-add="'+prefix+'"]');
      sel.addEventListener('change', function(){
        addBtn.disabled = !sel.value;
        setHint(prefix, '');
      });
      addBtn.addEventListener('click', function(){
        const id = sel.value;
        if (!id) return;
        const item = findCatalogItem(prefix, id);
        if (!item) return;
        const cart = getOrderCart(p.id);
        const dup = cart.some(function(e){ return e.domain===prefix && e.itemId===id; });
        if (dup){
          setHint(prefix, item.label+' is already on the pending order list.', true);
          return;
        }
        cart.push({ domain:prefix, itemId:item.id, label:item.label, medData:null });
        sel.value = '';
        addBtn.disabled = true;
        setHint(prefix, 'Added: '+item.label);
        refreshCart();
      });
    });

    placeBtn.addEventListener('click', function(){
      const cart = getOrderCart(p.id);
      if (!cart.length) return;
      const buckets = { lab:[], img:[], proc:[], diet:[], med:[] };
      cart.forEach(function(e){
        if (buckets[e.domain]) buckets[e.domain].push({ id:e.itemId, label:e.label, medData:e.medData||null });
      });
      Object.keys(buckets).forEach(function(prefix){
        if (buckets[prefix].length) placeOrders(p.id, PLACE_CATEGORY[prefix], buckets[prefix]);
      });
      STATE.orderCart[p.id] = [];
      refreshCart();
      renderPatientList();
      setSub('history');
    });

    const addCustomMedBtn = document.getElementById('addCustomMedBtn');
    addCustomMedBtn.addEventListener('click', function(){
      const drugEl = document.getElementById('customMedDrug');
      const doseEl = document.getElementById('customMedDose');
      const routeEl = document.getElementById('customMedRoute');
      const freqEl = document.getElementById('customMedFreq');
      const prnEl = document.getElementById('customMedPrnIndication');
      const errEl = document.getElementById('customMedError');
      const drug = drugEl.value.trim();
      const dose = doseEl.value.trim();
      const route = routeEl.value;
      const frequency = freqEl.value;
      const prnIndication = prnEl.value.trim();
      if (!drug || !dose){
        errEl.textContent = 'Enter at least a medication name and a dose.';
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';
      const prn = frequency==='PRN' || !!prnIndication;
      const label = drug+' '+dose+' '+route+' '+frequency+(prnIndication ? ' PRN '+prnIndication : '');
      getOrderCart(p.id).push({
        domain: 'med',
        itemId: 'custom_'+uid('med'),
        label: label,
        medData: { drug:drug, dose:dose, route:route, frequency:frequency, prn:prn, indication:prnIndication, label:label }
      });
      drugEl.value=''; doseEl.value=''; prnEl.value='';
      refreshCart();
    });

    refreshCart();
  }

  function orderResultBodyHtml(order){
    if (!order.result) return '';
    if (order.result.kind==='numeric') return '<div class="order-result">'+renderLabLinesHtml(order.result.lines)+'</div>';
    return '<div class="order-result">'+escapeHtml(order.result.text)+'</div>';
  }

  /* ---------------------------------------------------------------
     RENDER: Trends — pivots every resulted numeric lab (prior records
     and current encounter alike) into one analyte-by-date table. This
     is the view that lets a student distinguish an acute rise from a
     long-standing chronic derangement, which a single result cannot
     show. Analytes with only one data point are listed separately so
     the trended values stay uncluttered.
  --------------------------------------------------------------- */
  function collectTrendSeries(p){
    const list = (STATE.orders[p.id]||[]).filter(function(o){
      return o.category==='lab' && o.status==='resulted' && o.result && o.result.kind==='numeric';
    }).sort(function(a,b){ return a.resultAt-b.resultAt; });

    // Build a map from calendar-date string -> earliest resultAt timestamp for that date.
    // This ensures that multiple panels resulted on the same calendar day collapse into a
    // single column rather than producing one column per panel's unique millisecond timestamp.
    const dateKeyMap = {}; // dateStr -> canonical ts (earliest on that date)
    list.forEach(function(o){
      const dateStr = fmtDate(o.resultAt);
      if (dateKeyMap[dateStr] === undefined || o.resultAt < dateKeyMap[dateStr]){
        dateKeyMap[dateStr] = o.resultAt;
      }
    });

    const byComp = {};
    const compOrder = [];
    const dateSet = {};
    list.forEach(function(o){
      // Map this order's timestamp to the canonical key for its calendar date
      const ts = dateKeyMap[fmtDate(o.resultAt)];
      dateSet[ts] = true;
      (o.result.lines||[]).forEach(function(l){
        if (!byComp[l.compId]){
          byComp[l.compId] = { compId:l.compId, label:l.label, unit:l.unit, range:l.range, points:{} };
          compOrder.push(l.compId);
        }
        byComp[l.compId].points[ts] = { value:l.value, raw:l.raw, flag:l.flag, historical:!!o.historical };
      });
    });
    // Newest date on the left → descending sort for column display.
    // The sparkline needs oldest-first so its left-to-right line reads chronologically;
    // expose a separate ascending copy for that purpose.
    const datesAsc = Object.keys(dateSet).map(Number).sort(function(a,b){ return a-b; });
    const dates    = datesAsc.slice().reverse();
    return { dates: dates, datesAsc: datesAsc, comps: compOrder.map(function(id){ return byComp[id]; }) };
  }

  function sparklineHtml(comp, dates){
    const pts = dates.map(function(d){ return comp.points[d]; }).filter(Boolean);
    if (pts.length < 2) return '';
    const vals = pts.map(function(x){ return x.raw; });
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi===lo){ hi = lo + 1; lo = lo - 1; }
    const W = 88, H = 22, pad = 3;
    const step = (W - pad*2) / (pts.length - 1);
    const coords = pts.map(function(x, i){
      const px = pad + i*step;
      const py = H - pad - ((x.raw - lo) / (hi - lo)) * (H - pad*2);
      return { x: px.toFixed(1), y: py.toFixed(1), flag: x.flag };
    });
    const path = coords.map(function(c,i){ return (i===0?'M':'L')+c.x+' '+c.y; }).join(' ');
    const dotsHtml = coords.map(function(c){
      const fill = (c.flag==='C') ? 'var(--red)' : (c.flag==='H' ? 'var(--red)' : (c.flag==='L' ? '#1d6fae' : 'var(--teal)'));
      return '<circle cx="'+c.x+'" cy="'+c.y+'" r="2" fill="'+fill+'"/>';
    }).join('');
    return '<svg class="trend-spark" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" aria-hidden="true">'+
      '<path d="'+path+'" fill="none" stroke="var(--ink-faint)" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>'+
      dotsHtml+'</svg>';
  }

  function trendCellHtml(pt){
    if (!pt) return '<td class="trend-cell empty">\u2014</td>';
    const cls = pt.flag==='C' ? 'crit' : (pt.flag==='H' ? 'hi' : (pt.flag==='L' ? 'lo' : ''));
    const flagTxt = pt.flag==='C' ? ' CRIT' : (pt.flag ? ' '+pt.flag : '');
    return '<td class="trend-cell '+cls+'">'+pt.value+'<span class="trend-flag">'+flagTxt+'</span></td>';
  }

  /* ---------------------------------------------------------------
     Outside-records helpers — read and write priorRecords.labs for
     the currently open patient, persisting through the same override
     mechanism used for demographic edits:
       • custom patients   → mutate the object in STATE.customPatients
       • built-in patients → accumulate into STATE.patientOverrides[id]
     Both paths then re-run buildPriorOrders so the historical order
     objects in STATE.orders stay in sync with the source array.
  --------------------------------------------------------------- */
  function getPatientPriorLabs(patientId){
    const p = PATIENT_BY_ID[patientId];
    return (p && p.priorRecords && p.priorRecords.labs) ? p.priorRecords.labs : [];
  }

  function addPatientPriorLab(patientId, entry){
    // Find the mutable patient object — either custom or a writable override stub
    let mutable = STATE.customPatients.find(function(cp){ return cp.id===patientId; });
    if (!mutable){
      // Built-in patient: work through patientOverrides
      if (!STATE.patientOverrides[patientId]) STATE.patientOverrides[patientId] = {};
      const ov = STATE.patientOverrides[patientId];
      // Bootstrap priorRecords from the canonical patient if the override doesn't have it yet
      const canonical = PATIENTS.find(function(bp){ return bp.id===patientId; }) || {};
      if (!ov.priorRecords){
        const baseLabs = (canonical.priorRecords && canonical.priorRecords.labs) ? canonical.priorRecords.labs.slice() : [];
        ov.priorRecords = { labs: baseLabs, imaging: [], procedures: [] };
      }
      mutable = ov;
    }
    if (!mutable.priorRecords) mutable.priorRecords = { labs:[], imaging:[], procedures:[] };
    if (!mutable.priorRecords.labs) mutable.priorRecords.labs = [];
    mutable.priorRecords.labs.push(entry);

    // Rebuild the index so PATIENT_BY_ID reflects the new priorRecords value
    reindexPatients();
    // Rebuild prior orders from scratch and prepend them; current-encounter orders are kept
    const currentEncounterOrders = (STATE.orders[patientId]||[]).filter(function(o){ return !o.historical; });
    const freshPrior = buildPriorOrders(PATIENT_BY_ID[patientId]);
    STATE.orders[patientId] = freshPrior.concat(currentEncounterOrders);
    saveStoredState();
  }

  function removePatientPriorLab(patientId, index){
    let mutable = STATE.customPatients.find(function(cp){ return cp.id===patientId; });
    if (!mutable){
      if (!STATE.patientOverrides[patientId]) return;
      mutable = STATE.patientOverrides[patientId];
    }
    if (!mutable.priorRecords || !mutable.priorRecords.labs) return;
    mutable.priorRecords.labs.splice(index, 1);
    reindexPatients();
    const currentEncounterOrders = (STATE.orders[patientId]||[]).filter(function(o){ return !o.historical; });
    const freshPrior = buildPriorOrders(PATIENT_BY_ID[patientId]);
    STATE.orders[patientId] = freshPrior.concat(currentEncounterOrders);
    saveStoredState();
  }

  /* Build an inline outside-records entry form (mirrors the new-patient builder
     hist rows, but rendered in-place inside the Trends panel). */
  function renderOutsideRecordsFormHtml(panelId, values){
    // Reuse the existing per-component value fields renderer
    return renderLabValueFieldsHtml(panelId, values || null);
  }

  function bindOutsideRecordsPanel(p, host){
    const listEl       = host.querySelector('#orList');
    const addBtn       = host.querySelector('#orAddBtn');
    const formWrap     = host.querySelector('#orFormWrap');
    const dateInput    = host.querySelector('#orDate');
    const panelSel     = host.querySelector('#orPanel');
    const byInput      = host.querySelector('#orBy');
    const valsHost     = host.querySelector('#orValsHost');
    const saveBtn      = host.querySelector('#orSaveBtn');
    const cancelBtn    = host.querySelector('#orCancelBtn');

    function paintList(){
      const labs = getPatientPriorLabs(p.id);
      if (!labs.length){
        listEl.innerHTML = '<div style="font-size:12px;color:var(--ink-faint);padding:4px 0 8px;">No outside records entered yet.</div>';
      } else {
        listEl.innerHTML = labs.map(function(e, i){
          const panel = LAB_PANELS[e.panelId];
          return '<div class="outside-record-item">'+
            '<span class="or-date">'+escapeHtml(e.date)+'</span>'+
            '<span class="or-label">'+(panel ? escapeHtml(panel.label) : escapeHtml(e.panelId))+'</span>'+
            '<span class="or-src">'+(e.orderedBy ? escapeHtml(e.orderedBy) : 'Outside records')+'</span>'+
            '<button class="or-del" data-or-idx="'+i+'" type="button" aria-label="Remove this record">Remove</button>'+
            '</div>';
        }).join('');
        Array.prototype.forEach.call(listEl.querySelectorAll('[data-or-idx]'), function(btn){
          btn.addEventListener('click', function(){
            const idx = parseInt(btn.getAttribute('data-or-idx'), 10);
            if (!window.confirm('Remove this outside lab record? This cannot be undone.')) return;
            removePatientPriorLab(p.id, idx);
            renderTrendsPanel(p);
          });
        });
      }
    }

    function paintVals(){
      valsHost.innerHTML = renderOutsideRecordsFormHtml(panelSel.value, null);
    }

    paintList();
    panelSel.addEventListener('change', paintVals);
    paintVals();

    addBtn.addEventListener('click', function(){
      formWrap.style.display = '';
      addBtn.style.display = 'none';
      dateInput.value = '';
      byInput.value = '';
      panelSel.value = panelSel.options[0] ? panelSel.options[0].value : '';
      paintVals();
      dateInput.focus();
    });

    cancelBtn.addEventListener('click', function(){
      formWrap.style.display = 'none';
      addBtn.style.display = '';
    });

    saveBtn.addEventListener('click', function(){
      const date = dateInput.value.trim();
      const panelId = panelSel.value;
      if (!date){ dateInput.focus(); dateInput.style.outline='2px solid var(--red)'; return; }
      dateInput.style.outline='';
      if (!panelId) return;
      const ts = parseHistoryDate(date);
      if (ts===null){ dateInput.style.outline='2px solid var(--red)'; return; }
      dateInput.style.outline='';
      const panel = LAB_PANELS[panelId];
      const values = {};
      if (panel && panel.kind==='text'){
        const textEl = valsHost.querySelector('[data-labtext]');
        if (textEl && textEl.value.trim()) values.text = textEl.value.trim();
      } else {
        Array.prototype.forEach.call(valsHost.querySelectorAll('[data-comp]'), function(inp){
          const v = inp.value.trim();
          if (v!=='' && !isNaN(parseFloat(v))) values[inp.getAttribute('data-comp')] = parseFloat(v);
        });
      }
      const entry = { date: date, panelId: panelId, values: values, orderedBy: byInput.value.trim() || undefined };
      addPatientPriorLab(p.id, entry);
      renderTrendsPanel(p);  // full re-render picks up the new record
    });
  }

  function renderTrendsPanel(p){
    const host = document.getElementById('subTrends');
    if (!host) return;
    const series = collectTrendSeries(p);
    if (!series.dates.length){
      // Even with no data yet, still render the Outside Records card so
      // an instructor can enter historical labs from this very first visit.
      const numericPanelOptsEmpty = (function(){
        return buildLabOrderGroups().map(function(g){
          const opts = g.items.filter(function(it){ return LAB_PANELS[it.id] && LAB_PANELS[it.id].kind==='numeric'; })
            .map(function(it){ return '<option value="'+escapeHtml(it.id)+'">'+escapeHtml(it.label)+'</option>'; }).join('');
          return opts ? '<optgroup label="'+escapeHtml(g.category)+'">'+opts+'</optgroup>' : '';
        }).join('');
      })();
      host.innerHTML =
        '<div class="card">'+
          '<div class="outside-records-bar">'+
            '<div><h3 style="margin:0 0 2px;">Prior &amp; Outside Records</h3>'+
              '<p style="margin:0;font-size:12px;color:var(--ink-dim);">Enter historical labs from outside facilities or prior encounters to populate the trend table.</p>'+
            '</div>'+
            '<button class="btn-secondary" id="orAddBtn" type="button" style="flex-shrink:0;">+ Add Outside Lab</button>'+
          '</div>'+
          '<div class="outside-record-list" id="orList"></div>'+
          '<div class="outside-form" id="orFormWrap" style="display:none;">'+
            '<div class="outside-form-grid">'+
              '<div class="field" style="margin:0;"><label>Date of Service</label>'+
                '<input type="date" id="orDate" style="width:100%;"></div>'+
              '<div class="field" style="margin:0;"><label>Panel</label>'+
                '<select id="orPanel" style="width:100%;">'+numericPanelOptsEmpty+'</select></div>'+
              '<div class="field" style="margin:0;"><label>Source / Provider</label>'+
                '<input type="text" id="orBy" placeholder="e.g., PCP office, outside hospital" style="width:100%;"></div>'+
            '</div>'+
            '<div class="outside-form-vals" id="orValsHost"></div>'+
            '<div class="outside-form-foot">'+
              '<button class="btn-secondary" id="orCancelBtn" type="button">Cancel</button>'+
              '<button class="btn-primary" id="orSaveBtn" type="button">Save Record</button>'+
            '</div>'+
          '</div>'+
        '</div>'+
        '<div class="empty-state">No numeric lab results on file yet. Add outside records above, or order labs from the Place Orders tab.</div>';
      bindOutsideRecordsPanel(p, host);
      return;
    }
    const trended = series.comps.filter(function(c){ return Object.keys(c.points).length >= 2; });
    const single = series.comps.filter(function(c){ return Object.keys(c.points).length < 2; });

    const headHtml = '<tr><th class="trend-analyte">Analyte</th>'+
      series.dates.map(function(d){
        const anyHist = series.comps.some(function(c){ return c.points[d] && c.points[d].historical; });
        return '<th>'+fmtDate(d)+(anyHist?'<span class="trend-prior">prior</span>':'<span class="trend-prior cur">this stay</span>')+'</th>';
      }).join('')+
      '<th class="trend-spark-col">Trend</th><th class="trend-ref">Reference</th></tr>';

    function bodyRows(comps){
      return comps.map(function(c){
        return '<tr><td class="trend-analyte">'+escapeHtml(c.label)+
          '<span class="trend-unit">'+escapeHtml(c.unit||'')+'</span></td>'+
          series.dates.map(function(d){ return trendCellHtml(c.points[d]); }).join('')+
          '<td class="trend-spark-col">'+sparklineHtml(c, series.datesAsc)+'</td>'+
          '<td class="trend-ref">'+escapeHtml(c.range)+'</td></tr>';
      }).join('');
    }

    // Build the numeric lab panel options for the Outside Records panel picker
    const numericPanelOpts = (function(){
      return buildLabOrderGroups().map(function(g){
        const opts = g.items.filter(function(it){ return LAB_PANELS[it.id] && LAB_PANELS[it.id].kind==='numeric'; })
          .map(function(it){ return '<option value="'+escapeHtml(it.id)+'">'+escapeHtml(it.label)+'</option>'; }).join('');
        return opts ? '<optgroup label="'+escapeHtml(g.category)+'">'+opts+'</optgroup>' : '';
      }).join('');
    })();

    host.innerHTML =
      // ---- Outside Records entry card ----
      '<div class="card">'+
        '<div class="outside-records-bar">'+
          '<div><h3 style="margin:0 0 2px;">Prior &amp; Outside Records</h3>'+
            '<p style="margin:0;font-size:12px;color:var(--ink-dim);">Enter historical labs from outside facilities or prior encounters to populate the trend table below.</p>'+
          '</div>'+
          '<button class="btn-secondary" id="orAddBtn" type="button" style="flex-shrink:0;">+ Add Outside Lab</button>'+
        '</div>'+
        '<div class="outside-record-list" id="orList"></div>'+
        // Inline entry form — hidden until "Add Outside Lab" is clicked
        '<div class="outside-form" id="orFormWrap" style="display:none;">'+
          '<div class="outside-form-grid">'+
            '<div class="field" style="margin:0;"><label>Date of Service</label>'+
              '<input type="date" id="orDate" style="width:100%;"></div>'+
            '<div class="field" style="margin:0;"><label>Panel</label>'+
              '<select id="orPanel" style="width:100%;">'+numericPanelOpts+'</select></div>'+
            '<div class="field" style="margin:0;"><label>Source / Provider</label>'+
              '<input type="text" id="orBy" placeholder="e.g., PCP office, outside hospital" style="width:100%;"></div>'+
          '</div>'+
          '<div class="outside-form-vals" id="orValsHost"></div>'+
          '<div class="outside-form-foot">'+
            '<button class="btn-secondary" id="orCancelBtn" type="button">Cancel</button>'+
            '<button class="btn-primary" id="orSaveBtn" type="button">Save Record</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      // ---- Trend tables ----
      '<div class="card"><h3>Trended Results</h3>'+
        '<p style="font-size:12px;color:var(--ink-dim);margin-top:0;">Every resulted numeric lab for this patient, newest to oldest (left to right) \u2014 prior/outside records and this admission together. Use the interval between columns to judge whether an abnormal value is new or long-standing.</p>'+
        (trended.length
          ? '<div class="trend-wrap"><table class="trend-table"><thead>'+headHtml+'</thead><tbody>'+bodyRows(trended)+'</tbody></table></div>'
          : (series.dates.length
              ? '<div class="empty-state">Only one result on file so far \u2014 nothing to trend yet. Add an outside record above or order additional labs.</div>'
              : '<div class="empty-state">No numeric lab results on file yet. Add outside records above, or order labs from the Place Orders tab.</div>'))+
      '</div>'+
      (single.length
        ? '<div class="card"><h3>Single Data Point (no trend available)</h3>'+
            '<div class="trend-wrap"><table class="trend-table"><thead>'+headHtml+'</thead><tbody>'+bodyRows(single)+'</tbody></table></div>'+
          '</div>'
        : '');

    bindOutsideRecordsPanel(p, host);
  }

  /* ---------------------------------------------------------------
     RENDER: Order history — ONE table format for every result on every
     patient, current encounter and prior records alike. The two lists
     differ in what they contain, not in how they are read, so a student
     learns a single scanning pattern: item, source, date, status.
     Sort state is per-group because their useful default orderings
     differ (a live encounter reads newest-first; a reference archive
     reads grouped by item so repeats of one test sit together).
  --------------------------------------------------------------- */
  const ORDER_SORT = {
    current: { key:'date',  dir:'desc' },
    prior:   { key:'label', dir:'asc'  }
  };

  function orderSortComparator(state){
    return function(a, b){
      const dir = (state.dir==='asc') ? 1 : -1;
      if (state.key==='date'){
        if (a.orderedAt!==b.orderedAt) return (a.orderedAt-b.orderedAt)*dir;
        return a.label.localeCompare(b.label);
      }
      if (state.key==='source'){
        const c = (a.orderedBy||'').localeCompare(b.orderedBy||'');
        if (c!==0) return c*dir;
        return b.orderedAt-a.orderedAt;
      }
      if (state.key==='status'){
        const rank = function(o){ return o.status==='resulted' ? (o.critical?0:2) : 1; };
        if (rank(a)!==rank(b)) return (rank(a)-rank(b))*dir;
        return b.orderedAt-a.orderedAt;
      }
      const c = a.label.localeCompare(b.label);
      if (c!==0) return c*dir;
      return b.orderedAt-a.orderedAt;
    };
  }

  function orderCategoryLabel(o){
    return o.category==='lab' ? 'Lab'
      : o.category==='imaging' ? 'Imaging'
      : o.category==='procedure' ? 'Procedure' : 'Medication';
  }

  function orderStatusText(o){
    if (o.status!=='resulted') return 'Pending';
    if (o.category==='procedure') return 'Completed';
    if (o.category==='medication') return o.critical ? 'Allergy Alert' : 'Active';
    return o.critical ? 'Critical' : 'Resulted';
  }

  function ordersTableHtml(list, groupKey){
    const state = ORDER_SORT[groupKey];
    const rows = list.slice().sort(orderSortComparator(state));
    const arrow = function(key){
      if (state.key!==key) return '<span class="ord-arrow"></span>';
      return '<span class="ord-arrow on">'+(state.dir==='asc'?'\u25B2':'\u25BC')+'</span>';
    };
    let prevLabel = null;
    const bodyHtml = rows.map(function(o){
      const isResulted = o.status==='resulted';
      const statusClass = isResulted ? (o.critical?'critical':'resulted') : 'pending';
      const pulseDot = isResulted ? '' : '<span class="pulse-dot"></span>';
      const flag = (o.critical && o.category!=='medication') ? '<span class="ord-flag">Critical</span>'
        : (o.critical ? '<span class="ord-flag">Allergy</span>' : '');
      const seriesCls = (state.key==='label' && o.label===prevLabel) ? ' repeat' : '';
      prevLabel = o.label;
      const timeSub = o.historical ? '' : '<span class="ord-time">'+fmtTimeOnly(o.orderedAt)+'</span>';
      const detail = (o.expanded && isResulted)
        ? '<tr class="ord-detail"><td colspan="4">'+orderResultBodyHtml(o)+'</td></tr>'
        : '';
      const action = isResulted
        ? '<span class="ord-toggle">'+(o.expanded?'Hide':'View')+'</span>'
        : '';
      return '<tr class="ord-row'+seriesCls+(o.expanded&&isResulted?' open':'')+(isResulted?'':' is-pending')+'" '+
          'data-oid="'+o.id+'"'+(isResulted?' tabindex="0" role="button" aria-expanded="'+(o.expanded?'true':'false')+'"':'')+
          ' aria-label="'+escapeHtml(o.label)+', '+fmtDate(o.orderedAt)+', '+orderStatusText(o)+'">'+
        '<td class="ord-item"><span class="ord-cat">'+orderCategoryLabel(o)+'</span>'+escapeHtml(o.label)+flag+'</td>'+
        '<td class="ord-source">'+escapeHtml(o.orderedBy||'\u2014')+'</td>'+
        '<td class="ord-date">'+fmtDate(o.orderedAt)+timeSub+'</td>'+
        '<td class="ord-status-cell"><span class="order-status '+statusClass+'">'+pulseDot+orderStatusText(o)+'</span>'+action+'</td>'+
        '</tr>'+detail;
    }).join('');

    return '<div class="ord-wrap"><table class="ord-table" data-group="'+groupKey+'">'+
      '<colgroup>'+
        '<col class="col-item">'+
        '<col class="col-source">'+
        '<col class="col-date">'+
        '<col class="col-status">'+
      '</colgroup>'+
      '<thead><tr>'+
        '<th class="ord-sort" data-sortkey="label" data-group="'+groupKey+'" scope="col">Item'+arrow('label')+'</th>'+
        '<th class="ord-sort" data-sortkey="source" data-group="'+groupKey+'" scope="col">Source'+arrow('source')+'</th>'+
        '<th class="ord-sort" data-sortkey="date" data-group="'+groupKey+'" scope="col">Date'+arrow('date')+'</th>'+
        '<th class="ord-sort ord-status-head" data-sortkey="status" data-group="'+groupKey+'" scope="col">Status'+arrow('status')+'</th>'+
      '</tr></thead><tbody>'+bodyHtml+'</tbody></table></div>';
  }

  /* Category labels in the order they appear as headings */
  const ORDER_CATEGORIES = [
    { cat:'lab',       label:'Labs'        },
    { cat:'imaging',   label:'Imaging'     },
    { cat:'procedure', label:'Procedures'  },
    { cat:'medication',label:'Medications' }
  ];

  function renderOrderHistory(p){
    const subHistory = document.getElementById('subHistory');
    if (!subHistory) return;
    const all = (STATE.orders[p.id]||[]).slice();
    if (!all.length){ subHistory.innerHTML = '<div class="empty-state">No orders placed yet for this patient.</div>'; return; }
    const current = all.filter(function(o){ return !o.historical; });
    const prior   = all.filter(function(o){ return  o.historical; });

    function sectionHtml(pool, groupKeyPrefix){
      return ORDER_CATEGORIES.map(function(oc){
        const items = pool.filter(function(o){ return o.category===oc.cat; });
        if (!items.length) return '';
        const key = groupKeyPrefix+'_'+oc.cat;
        if (!ORDER_SORT[key]) ORDER_SORT[key] = {
          key: (groupKeyPrefix==='prior') ? 'label' : 'date',
          dir: (groupKeyPrefix==='prior') ? 'asc'   : 'desc'
        };
        return '<div class="history-group">'+
          '<h4 class="history-group-head">'+oc.label+'</h4>'+
          ordersTableHtml(items, key)+
          '</div>';
      }).join('');
    }

    const currentHtml = sectionHtml(current,'current');
    const priorHtml   = sectionHtml(prior,  'prior');

    subHistory.innerHTML =
      '<div class="hist-era">'+
        '<h3 class="hist-era-head">This Encounter</h3>'+
        (currentHtml || '<div class="empty-state">No orders placed yet this encounter.</div>')+
      '</div>'+
      (prior.length
        ? '<div class="hist-era">'+
            '<h3 class="hist-era-head prior-era">Prior &amp; Outside Records</h3>'+
            priorHtml+
          '</div>'
        : '');

    Array.prototype.forEach.call(subHistory.querySelectorAll('.ord-row:not(.is-pending)'), function(row){
      row.addEventListener('click', function(){
        const oid = row.getAttribute('data-oid');
        const order = (STATE.orders[p.id]||[]).find(function(o){ return o.id===oid; });
        if (order){
          order.expanded = !order.expanded;
          if (order.expanded && order.category==='lab' && !order.historical){
            saveStoredState();
            renderPatientList();
          }
          renderOrderHistory(p);
        }
      });
      row.addEventListener('keydown', function(e){
        if (e.key==='Enter' || e.key===' '){ e.preventDefault(); row.click(); }
      });
    });
    Array.prototype.forEach.call(subHistory.querySelectorAll('.ord-sort'), function(th){
      th.addEventListener('click', function(){
        const key = th.getAttribute('data-sortkey');
        const state = ORDER_SORT[th.getAttribute('data-group')];
        if (state.key===key){ state.dir = (state.dir==='asc') ? 'desc' : 'asc'; }
        else { state.key = key; state.dir = (key==='date') ? 'desc' : 'asc'; }
        renderOrderHistory(p);
      });
    });
  }

  /* ---------------------------------------------------------------
     RENDER: Medications tab — active drug orders + diet orders
  --------------------------------------------------------------- */
  function renderMedicationsPanel(p){
    const orders = (STATE.orders[p.id]||[]).filter(function(o){
      return (o.category==='medication' || o.category==='diet' || o.category==='procedure') && o.status==='resulted';
    });

    // Separate active diet orders (show only the most-recent one as current)
    const dietOrders = orders.filter(function(o){ return o.category==='diet'; })
      .sort(function(a,b){ return b.orderedAt-a.orderedAt; });
    const medOrders = orders.filter(function(o){ return o.category==='medication'; })
      .sort(function(a,b){ return a.label.localeCompare(b.label); });
    // Monitoring orders — all active (procedure category + Monitoring subcategory)
    const monitorOrders = orders.filter(function(o){
      return o.category==='procedure' && PROCEDURES[o.itemId] && PROCEDURES[o.itemId].category==='Monitoring';
    }).sort(function(a,b){ return b.orderedAt-a.orderedAt; });

    const currentDiet = dietOrders[0] || null;
    const dietHtml = currentDiet
      ? '<div class="card"><h3>Current Diet Order</h3>'+
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'+
            '<span class="diet-chip">'+escapeHtml(currentDiet.label)+'</span>'+
            '<span style="font-size:11.5px;color:var(--ink-faint);">ordered '+fmtDateTime(currentDiet.orderedAt)+(currentDiet.historical?' · Prior record':'')+'</span>'+
          '</div>'+
          (dietOrders.length>1 ? '<p style="font-size:11.5px;color:var(--ink-faint);margin:8px 0 0;">'+
            (dietOrders.length-1)+' prior diet order'+(dietOrders.length>2?'s':'')+' superseded.</p>' : '')+
        '</div>'
      : '<div class="card"><div class="empty-state">No diet order on file. Place one from Orders &amp; Results → Place Orders → Diet &amp; Nutrition.</div></div>';

    const monitorHtml = monitorOrders.length
      ? '<div class="card"><h3>Active Monitoring Orders</h3>'+
          monitorOrders.map(function(o){
            const proc = PROCEDURES[o.itemId];
            return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">'+
              '<span class="monitor-chip">&#9679; '+escapeHtml(proc ? proc.label : o.label)+'</span>'+
              '<span style="font-size:11.5px;color:var(--ink-faint);">ordered '+fmtDateTime(o.orderedAt)+'</span>'+
            '</div>';
          }).join('')+
        '</div>'
      : '';

    const medRowsHtml = medOrders.length
      ? '<div class="ord-wrap"><table class="med-mar-table"><thead><tr>'+
          '<th>Medication</th><th>Class</th><th>Ordered</th><th>PRN</th>'+
        '</tr></thead><tbody>'+
        medOrders.map(function(o){
          const m = MEDICATIONS[o.itemId];
          const cls = m ? m.class : (o.medData ? 'Custom order' : '—');
          const prn = (m && m.prn) || (o.medData && o.medData.prn);
          return '<tr>'+
            '<td><span class="ord-item">'+escapeHtml(o.label)+'</span>'+(o.critical?'<span class="ord-flag">Allergy alert</span>':'')+'</td>'+
            '<td><span class="med-class-tag">'+escapeHtml(cls)+'</span></td>'+
            '<td style="white-space:nowrap;font-size:12px;color:var(--ink-faint);">'+fmtDate(o.orderedAt)+'</td>'+
            '<td style="font-size:12px;">'+(prn?'PRN':'Scheduled')+'</td>'+
          '</tr>';
        }).join('')+
        '</tbody></table></div>'
      : '<div class="empty-state">No medication orders on file yet. Place orders from Orders &amp; Results → Place Orders → Medications.</div>';

    panelMedications.innerHTML =
      dietHtml+
      monitorHtml+
      '<div class="card"><h3>Active Medication Orders</h3>'+medRowsHtml+'</div>';
  }

  /* ---------------------------------------------------------------
     RENDER: Vitals tab — trend table + entry form
  --------------------------------------------------------------- */
  function parseVitalNum(s){ var n=parseFloat(String(s).replace(/[^\d.]/,'')); return isNaN(n)?null:n; }

  function vsFlag(param, val){
    // Returns '' | 'low' | 'high' for simple range checks
    var n = parseVitalNum(val);
    if (n===null) return '';
    if (param==='temp')  return n<97.0?'low':(n>99.5?'high':'');
    if (param==='hr')    return n<60?'low':(n>100?'high':'');
    if (param==='rr')    return n<12?'low':(n>20?'high':'');
    if (param==='spo2')  return n<95?'low':'';
    if (param==='pain')  return n>6?'high':'';
    if (param==='bp'){
      var parts=String(val).split('/');
      var sys=parseFloat(parts[0]),dia=parseFloat(parts[1]||'0');
      if (!isNaN(sys) && (sys<90||sys>160)) return sys<90?'low':'high';
      if (!isNaN(dia) && (dia<60||dia>100)) return dia<60?'low':'high';
    }
    return '';
  }

  function renderVitalsPanel(p){
    if (!STATE.vitals[p.id]) STATE.vitals[p.id] = seedAdmissionVitals(p);
    var records = STATE.vitals[p.id].slice().sort(function(a,b){ return b.timestamp-a.timestamp; });

    var PARAMS = [
      {key:'temp', label:'Temp (°F)'},
      {key:'hr',   label:'HR (bpm)'},
      {key:'bp',   label:'BP (mmHg)'},
      {key:'rr',   label:'RR (/min)'},
      {key:'spo2', label:'SpO2 (%)'},
      {key:'pain', label:'Pain (/10)'}
    ];

    var headCols = records.map(function(r){
      return '<th>'+(r.historical?'<span style="color:var(--ink-faint);font-size:9.5px;">PRIOR</span><br>':'')+
        escapeHtml(fmtDate(r.timestamp))+'<br><span style="font-size:9.5px;font-weight:400;">'+fmtTimeOnly(r.timestamp)+'</span></th>';
    }).join('');

    var bodyRows = PARAMS.map(function(param){
      var cells = records.map(function(r){
        var v = r[param.key]||'—';
        var flag = vsFlag(param.key, v);
        return '<td class="'+(flag?'vs-abnormal':'')+'">'+(flag==='low'?'▼ ':flag==='high'?'▲ ':'')+escapeHtml(String(v))+'</td>';
      }).join('');
      return '<tr><td class="vs-param">'+escapeHtml(param.label)+'</td>'+cells+'</tr>';
    }).join('');

    var noteRow = '<tr><td class="vs-param" style="color:var(--ink-faint);font-weight:400;">Note</td>'+
      records.map(function(r){ return '<td style="font-size:11px;color:var(--ink-faint);">'+escapeHtml(r.note||'')+'</td>'; }).join('')+'</tr>';

    var tableHtml = records.length
      ? '<div class="trend-wrap"><table class="vs-trend-table"><thead><tr><th class="vs-param">Parameter</th>'+headCols+'</tr></thead><tbody>'+bodyRows+noteRow+'</tbody></table></div>'
      : '<div class="empty-state">No vitals recorded yet.</div>';

    panelVitals.innerHTML =
      '<div class="card"><h3>Vital Signs Trend</h3>'+
        '<p style="font-size:12px;color:var(--ink-dim);margin-top:0;">Newest on the left. ▲ = above normal range · ▼ = below normal range. Historical (prior admission) entries are labeled <em>PRIOR</em>.</p>'+
        tableHtml+
      '</div>'+
      '<div class="card"><h3>Add Vital Signs Entry</h3>'+
        '<p style="font-size:12px;color:var(--ink-dim);margin-top:0;">Enter current or historical vitals. Historical entries are labeled as prior-admission records in the trend table above.</p>'+
        '<div class="field-row" style="grid-template-columns:200px 1fr 80px;align-items:end;">'+
          '<div class="field" style="margin:0;"><label>Date &amp; Time</label><input type="datetime-local" id="vsDateTime"></div>'+
          '<div class="field" style="margin:0;"><label>Note / context (optional)</label><input type="text" id="vsNote" placeholder="e.g., post-op check, transfer vitals"></div>'+
          '<div class="field" style="margin:0;"><label style="font-size:11px;">Historical?</label>'+
            '<div style="display:flex;align-items:center;gap:5px;padding:7px 0;"><input type="checkbox" id="vsHistorical"><label for="vsHistorical" style="margin:0;font-size:12px;">Prior admit</label></div></div>'+
        '</div>'+
        '<div class="vs-entry-grid" style="margin-top:10px;">'+
          '<div class="hist-val"><label>Temp (°F)<span class="hist-val-unit">ref 97–99.5</span></label><input type="text" id="vsTemp" placeholder="98.6"></div>'+
          '<div class="hist-val"><label>HR (bpm)<span class="hist-val-unit">ref 60–100</span></label><input type="text" id="vsHr" placeholder="80"></div>'+
          '<div class="hist-val"><label>BP (mmHg)<span class="hist-val-unit">ref 90–160/60–100</span></label><input type="text" id="vsBp" placeholder="120/80"></div>'+
          '<div class="hist-val"><label>RR (/min)<span class="hist-val-unit">ref 12–20</span></label><input type="text" id="vsRr" placeholder="16"></div>'+
          '<div class="hist-val"><label>SpO2 (%)<span class="hist-val-unit">ref ≥95</span></label><input type="text" id="vsSpo2" placeholder="98"></div>'+
          '<div class="hist-val"><label>Pain (/10)<span class="hist-val-unit">0–10</span></label><input type="text" id="vsPain" placeholder="0"></div>'+
        '</div>'+
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">'+
          '<button class="btn-secondary" id="vsClearBtn" type="button">Clear</button>'+
          '<button class="btn-primary" id="vsSaveBtn" type="button">Save Entry</button>'+
        '</div>'+
        '<div id="vsError" style="color:var(--red);font-size:12px;margin-top:6px;display:none;"></div>'+
      '</div>';

    // Pre-fill datetime to now
    var nowLocal = new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
    document.getElementById('vsDateTime').value = nowLocal;

    document.getElementById('vsClearBtn').addEventListener('click', function(){
      ['vsTemp','vsHr','vsBp','vsRr','vsSpo2','vsPain','vsNote'].forEach(function(id){ document.getElementById(id).value=''; });
      document.getElementById('vsHistorical').checked = false;
      document.getElementById('vsDateTime').value = nowLocal;
      document.getElementById('vsError').style.display='none';
    });
    document.getElementById('vsSaveBtn').addEventListener('click', function(){
      var dtVal = document.getElementById('vsDateTime').value;
      var errEl = document.getElementById('vsError');
      if (!dtVal){ errEl.textContent='Please enter a date and time.'; errEl.style.display='block'; return; }
      var ts = new Date(dtVal).getTime();
      if (isNaN(ts)){ errEl.textContent='Invalid date/time.'; errEl.style.display='block'; return; }
      errEl.style.display='none';
      var entry = {
        id: uid('vs'),
        timestamp: ts,
        temp: document.getElementById('vsTemp').value.trim() || '—',
        hr:   document.getElementById('vsHr').value.trim()   || '—',
        bp:   document.getElementById('vsBp').value.trim()   || '—',
        rr:   document.getElementById('vsRr').value.trim()   || '—',
        spo2: document.getElementById('vsSpo2').value.trim() || '—',
        pain: document.getElementById('vsPain').value.trim() || '—',
        note: document.getElementById('vsNote').value.trim(),
        historical: document.getElementById('vsHistorical').checked
      };
      if (!STATE.vitals[p.id]) STATE.vitals[p.id]=[];
      STATE.vitals[p.id].push(entry);
      saveStoredState();
      renderVitalsPanel(p);
    });

    // Wire delete buttons (added after re-render via event delegation on the table)
    panelVitals.addEventListener('click', function(e){
      var btn = e.target.closest('[data-vs-del]');
      if (!btn) return;
      var vsId = btn.getAttribute('data-vs-del');
      if (!window.confirm('Remove this vitals entry?')) return;
      STATE.vitals[p.id] = (STATE.vitals[p.id]||[]).filter(function(r){ return r.id!==vsId; });
      saveStoredState();
      renderVitalsPanel(p);
    }, { once:true });
  }

  /* ---------------------------------------------------------------
     RENDER: I/O tab — intake and output tracking
  --------------------------------------------------------------- */
  var IO_TYPES = {
    intake: ['IV Fluids','Oral Intake','Tube Feeds','Blood Products','Medications (IV volume)','Other Intake'],
    output: ['Urine Output','Emesis','Stool','Nasogastric Drainage','Drain Output','Insensible Losses (estimated)','Blood Loss','Other Output']
  };

  function renderIOPanel(p){
    if (!STATE.io[p.id]) STATE.io[p.id]=[];
    var records = STATE.io[p.id].slice().sort(function(a,b){ return b.timestamp-a.timestamp; });

    // 24h totals
    var cutoff24 = Date.now()-24*60*60*1000;
    var total24I=0, total24O=0;
    records.forEach(function(r){
      if (r.timestamp>=cutoff24){
        if (r.category==='intake') total24I+=Number(r.amount)||0;
        else total24O+=Number(r.amount)||0;
      }
    });
    var balance24=total24I-total24O;

    // All-time totals
    var totalI=0, totalO=0;
    records.forEach(function(r){
      if (r.category==='intake') totalI+=Number(r.amount)||0;
      else totalO+=Number(r.amount)||0;
    });

    var detailRows = records.map(function(r){
      return '<tr>'+
        '<td style="white-space:nowrap;font-size:12px;">'+fmtDateTime(r.timestamp)+'</td>'+
        '<td class="'+(r.category==='intake'?'io-cat-intake':'io-cat-output')+'">'+escapeHtml(r.category==='intake'?'Intake':'Output')+'</td>'+
        '<td>'+escapeHtml(r.type||'')+'</td>'+
        '<td style="text-align:right;font-family:var(--font-data);font-weight:700;">'+Number(r.amount).toLocaleString()+' mL</td>'+
        '<td style="font-size:11.5px;color:var(--ink-faint);">'+escapeHtml(r.note||'')+'</td>'+
        '<td><button class="or-del" data-io-del="'+r.id+'" type="button">Remove</button></td>'+
      '</tr>';
    }).join('');

    var intakeTypeOpts = IO_TYPES.intake.map(function(t){ return '<option>'+escapeHtml(t)+'</option>'; }).join('');
    var outputTypeOpts = IO_TYPES.output.map(function(t){ return '<option>'+escapeHtml(t)+'</option>'; }).join('');

    panelIO.innerHTML =
      '<div class="card"><h3>24-Hour Summary</h3>'+
        '<div class="io-summary-grid">'+
          '<div class="io-total-box intake"><div class="io-total-label">Total Intake (24h)</div><div class="io-total-val">'+total24I.toLocaleString()+' <span style="font-size:14px;">mL</span></div></div>'+
          '<div class="io-total-box output"><div class="io-total-label">Total Output (24h)</div><div class="io-total-val">'+total24O.toLocaleString()+' <span style="font-size:14px;">mL</span></div></div>'+
        '</div>'+
        '<div class="io-total-box balance" style="margin-bottom:0;text-align:center;padding:10px 16px;">'+
          '<div class="io-total-label">24h Net Balance</div>'+
          '<div class="io-total-val" style="color:'+(balance24>=0?'var(--teal-dark)':'var(--red)')+';">'+(balance24>=0?'+':'')+balance24.toLocaleString()+' <span style="font-size:14px;">mL</span></div>'+
        '</div>'+
      '</div>'+
      '<div class="card"><h3>Add Entry</h3>'+
        '<div class="io-entry-grid">'+
          '<div class="field" style="margin:0;"><label>Date &amp; Time</label><input type="datetime-local" id="ioDateTime"></div>'+
          '<div class="field" style="margin:0;"><label>Category</label>'+
            '<select id="ioCategory">'+
              '<option value="intake">Intake</option>'+
              '<option value="output">Output</option>'+
            '</select></div>'+
          '<div class="field" style="margin:0;"><label>Type</label>'+
            '<select id="ioType">'+intakeTypeOpts+'</select></div>'+
          '<div class="field" style="margin:0;"><label>Amount (mL)</label><input type="number" id="ioAmount" min="0" placeholder="0"></div>'+
        '</div>'+
        '<div class="field" style="margin-top:8px;"><label>Note (optional)</label><input type="text" id="ioNote" placeholder="e.g., infusing, emesis x1 after meals"></div>'+
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">'+
          '<button class="btn-primary" id="ioSaveBtn" type="button">Save Entry</button>'+
        '</div>'+
        '<div id="ioError" style="color:var(--red);font-size:12px;margin-top:6px;display:none;"></div>'+
      '</div>'+
      (records.length ?
        '<div class="card"><h3>All Entries <span style="font-size:12px;font-weight:400;color:var(--ink-faint);">Cumulative: Intake '+totalI.toLocaleString()+' mL &nbsp;·&nbsp; Output '+totalO.toLocaleString()+' mL &nbsp;·&nbsp; Net '+(totalI-totalO>=0?'+':'')+(totalI-totalO).toLocaleString()+' mL</span></h3>'+
          '<div class="ord-wrap"><table class="io-detail-table"><thead><tr>'+
            '<th>Time</th><th>Category</th><th>Type</th><th style="text-align:right;">Amount</th><th>Note</th><th></th>'+
          '</tr></thead><tbody>'+detailRows+'</tbody></table></div>'+
        '</div>' : '')+
      '<div class="card" style="background:var(--amber-pale);border-color:#f0dcb0;">'+
        '<h3 style="color:#6b4a0a;margin-top:0;">Facilitator: Pre-set I&amp;O Values</h3>'+
        '<p style="font-size:12px;color:#6b4a0a;margin-top:0;">Use the entry form above to enter predetermined I&amp;O for educational scenarios (e.g., oliguric patient with 200 mL urine output over 8 hours, or fluid-overloaded patient with 4 L intake). Entries persist across sessions.</p>'+
      '</div>';

    // Pre-fill datetime
    var nowLocal = new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
    document.getElementById('ioDateTime').value = nowLocal;

    // Update type dropdown when category changes
    var catSel = document.getElementById('ioCategory');
    var typeSel = document.getElementById('ioType');
    catSel.addEventListener('change', function(){
      var opts = IO_TYPES[catSel.value].map(function(t){ return '<option>'+escapeHtml(t)+'</option>'; }).join('');
      typeSel.innerHTML = opts;
    });

    document.getElementById('ioSaveBtn').addEventListener('click', function(){
      var errEl = document.getElementById('ioError');
      var dtVal = document.getElementById('ioDateTime').value;
      var amt   = document.getElementById('ioAmount').value;
      if (!dtVal){ errEl.textContent='Please enter a date and time.'; errEl.style.display='block'; return; }
      var ts = new Date(dtVal).getTime();
      if (isNaN(ts)){ errEl.textContent='Invalid date/time.'; errEl.style.display='block'; return; }
      if (!amt||isNaN(Number(amt))||Number(amt)<0){ errEl.textContent='Please enter a valid amount (mL).'; errEl.style.display='block'; return; }
      errEl.style.display='none';
      STATE.io[p.id].push({
        id: uid('io'),
        timestamp: ts,
        category: catSel.value,
        type: typeSel.value,
        amount: Number(amt),
        note: document.getElementById('ioNote').value.trim()
      });
      saveStoredState();
      renderIOPanel(p);
    });

    panelIO.addEventListener('click', function(e){
      var btn = e.target.closest('[data-io-del]');
      if (!btn) return;
      var ioId = btn.getAttribute('data-io-del');
      if (!window.confirm('Remove this I/O entry?')) return;
      STATE.io[p.id] = (STATE.io[p.id]||[]).filter(function(r){ return r.id!==ioId; });
      saveStoredState();
      renderIOPanel(p);
    }, { once:true });
  }

  /* ---------------------------------------------------------------
     RENDER: Facilitator Panel — pre-determine lab results for a
     progressively unfolding case. Facilitators define one or more
     "stages" per patient (Baseline plus any additional stages), enter
     the intended value for whichever labs matter for that stage, and
     mark a stage "active" to reveal it the next time a student orders
     that test. Already-resulted orders are never changed retroactively.
     Fields left blank fall back to the patient's built-in baseline
     value, so nothing has to be re-entered for tests that don't change.
  --------------------------------------------------------------- */
  function ensureLabOverrideEntry(patientId){
    if (!STATE.labOverrides[patientId]){
      STATE.labOverrides[patientId] = {
        activeStageId: 'stage_baseline',
        stages: [ { id:'stage_baseline', label:'Baseline / Admission', profile:{}, textProfile:{} } ]
      };
    }
    return STATE.labOverrides[patientId];
  }

  function getUniqueLabComponentsGrouped(){
    const seen = {};
    const groups = {};
    const order = [];
    Object.keys(LAB_PANELS).forEach(function(panelId){
      const panel = LAB_PANELS[panelId];
      if (panel.kind!=='numeric') return;
      panel.components.forEach(function(comp){
        if (seen[comp.id]) return;
        seen[comp.id] = true;
        if (!groups[panel.category]){ groups[panel.category]=[]; order.push(panel.category); }
        groups[panel.category].push(comp);
      });
    });
    return order.map(function(cat){ return { category:cat, items:groups[cat] }; });
  }

  function getTextLabPanels(){
    return Object.keys(LAB_PANELS).filter(function(id){ return LAB_PANELS[id].kind==='text'; })
      .map(function(id){ return { id:id, label: LAB_PANELS[id].label }; });
  }

  function renderLabOverrideFormHtml(stage){
    const groups = getUniqueLabComponentsGrouped();
    let html = groups.map(function(g){
      return '<details class="order-group" open><summary>'+escapeHtml(g.category)+'</summary>'+
        '<div class="labov-grid">'+
        g.items.map(function(comp){
          const val = (stage.profile && stage.profile[comp.id]!==undefined) ? stage.profile[comp.id] : '';
          return '<div class="labov-field"><label>'+escapeHtml(comp.label)+' <span class="labov-unit">('+escapeHtml(comp.unit||'unitless')+', ref '+comp.range.join('\u2013')+')</span></label>'+
            '<input type="text" data-comp="'+comp.id+'" value="'+escapeHtml(String(val))+'" placeholder="default '+comp.def+'"></div>';
        }).join('')+
        '</div></details>';
    }).join('');
    html += '<details class="order-group" open><summary>Text-Based Results</summary><div class="labov-grid" style="grid-template-columns:1fr;">'+
      getTextLabPanels().map(function(t){
        const val = (stage.textProfile && stage.textProfile[t.id]!==undefined) ? stage.textProfile[t.id] : '';
        return '<div class="labov-field"><label>'+escapeHtml(t.label)+'</label><textarea data-textpanel="'+t.id+'" rows="2" placeholder="leave blank to use this patient\u2019s default">'+escapeHtml(val)+'</textarea></div>';
      }).join('')+
      '</div></details>';
    return html;
  }

  let facilitatorEditingStageId = null;

  function renderFacilitatorPanel(p){
    const entry = ensureLabOverrideEntry(p.id);
    if (!facilitatorEditingStageId || !entry.stages.some(function(s){ return s.id===facilitatorEditingStageId; })){
      facilitatorEditingStageId = entry.activeStageId;
    }
    const editingStage = entry.stages.find(function(s){ return s.id===facilitatorEditingStageId; });

    const chipsHtml = entry.stages.map(function(s){
      const isActive = s.id===entry.activeStageId;
      const isEditing = s.id===facilitatorEditingStageId;
      return '<button class="stage-chip'+(isEditing?' selected':'')+(isActive?' active-stage':'')+'" data-stage-id="'+s.id+'" type="button">'+
        escapeHtml(s.label)+(isActive?' <span class="stage-active-dot">\u25CF ACTIVE</span>':'')+
        (s.id!=='stage_baseline' ? '<span class="stage-del" data-del-stage="'+s.id+'" title="Delete stage">\u2715</span>' : '')+
        '</button>';
    }).join('');

    panelFacilitator.innerHTML =
      '<div class="disclaimer" style="background:var(--amber-pale);border-color:#f0dcb0;color:#6b4a0a;">'+
        '<b>Facilitator use only.</b> Configure the intended lab results for each stage of this unfolding case here, then mark a stage \u201cActive\u201d to reveal it the next time a student orders that test. Already-resulted orders are never changed retroactively. Students generally should not need this tab.'+
      '</div>'+
      '<div class="card"><h3>Case Stages</h3>'+
        '<div class="stage-strip">'+chipsHtml+'<button class="stage-chip stage-add" id="addStageBtn" type="button">+ Add Stage</button></div>'+
        '<div class="field" style="margin-top:12px;max-width:360px;"><label>Stage Name</label><input type="text" id="stageLabelInput" value="'+escapeHtml(editingStage.label)+'"></div>'+
        '<div>'+(editingStage.id!==entry.activeStageId
          ? '<button class="btn-primary" id="setActiveStageBtn" type="button">Set as Active for Students</button>'
          : '<span class="chip ok">Currently active for students</span>')+
        '</div>'+
      '</div>'+
      '<div class="card"><h3>Intended Values \u2014 '+escapeHtml(editingStage.label)+'</h3>'+
        '<p style="font-size:12px;color:var(--ink-dim);margin-top:0;">Leave a field blank to fall back to this patient\u2019s baseline/default value. Values here apply the next time a student orders that test while this stage is active \u2014 orders already placed and resulted are untouched.</p>'+
        '<div class="order-groups">'+renderLabOverrideFormHtml(editingStage)+'</div>'+
        '<div class="order-submit-row"><button class="btn-primary" id="saveStageValuesBtn" type="button">Save Changes to This Stage</button></div>'+
      '</div>';

    Array.prototype.forEach.call(panelFacilitator.querySelectorAll('.stage-chip[data-stage-id]'), function(btn){
      btn.addEventListener('click', function(e){
        if (e.target.closest('[data-del-stage]')) return;
        facilitatorEditingStageId = btn.getAttribute('data-stage-id');
        renderFacilitatorPanel(p);
      });
    });
    Array.prototype.forEach.call(panelFacilitator.querySelectorAll('[data-del-stage]'), function(delBtn){
      delBtn.addEventListener('click', function(e){
        e.stopPropagation();
        const sid = delBtn.getAttribute('data-del-stage');
        const ok = window.confirm('Delete this stage? This cannot be undone.');
        if (!ok) return;
        const entry2 = STATE.labOverrides[p.id];
        entry2.stages = entry2.stages.filter(function(s){ return s.id!==sid; });
        if (entry2.activeStageId===sid) entry2.activeStageId = entry2.stages[0].id;
        if (facilitatorEditingStageId===sid) facilitatorEditingStageId = entry2.activeStageId;
        saveStoredState();
        renderFacilitatorPanel(p);
      });
    });
    document.getElementById('addStageBtn').addEventListener('click', function(){
      const entry2 = STATE.labOverrides[p.id];
      const newStage = { id: uid('stage'), label: 'Stage '+(entry2.stages.length+1), profile:{}, textProfile:{} };
      entry2.stages.push(newStage);
      facilitatorEditingStageId = newStage.id;
      saveStoredState();
      renderFacilitatorPanel(p);
    });
    const setActiveBtn = document.getElementById('setActiveStageBtn');
    if (setActiveBtn){
      setActiveBtn.addEventListener('click', function(){
        STATE.labOverrides[p.id].activeStageId = facilitatorEditingStageId;
        saveStoredState();
        renderFacilitatorPanel(p);
      });
    }
    document.getElementById('saveStageValuesBtn').addEventListener('click', function(){
      const stage = STATE.labOverrides[p.id].stages.find(function(s){ return s.id===facilitatorEditingStageId; });
      stage.label = document.getElementById('stageLabelInput').value.trim() || stage.label;
      const profile = {};
      Array.prototype.forEach.call(panelFacilitator.querySelectorAll('[data-comp]'), function(input){
        const v = input.value.trim();
        if (v!==''){
          const n = parseFloat(v);
          if (!isNaN(n)) profile[input.getAttribute('data-comp')] = n;
        }
      });
      const textProfile = {};
      Array.prototype.forEach.call(panelFacilitator.querySelectorAll('[data-textpanel]'), function(ta){
        const v = ta.value.trim();
        if (v!=='') textProfile[ta.getAttribute('data-textpanel')] = v;
      });
      stage.profile = profile;
      stage.textProfile = textProfile;
      saveStoredState();
      renderFacilitatorPanel(p);
    });
  }

  /* ---------------------------------------------------------------
     Top bar wiring: clock, about modal, reset-all
  --------------------------------------------------------------- */
  const clockReadoutEl = document.getElementById('clockReadout');
  function updateClock(){
    const now = new Date();
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2,'0');
    const ap = h>=12?'PM':'AM';
    h = h%12; if (h===0) h=12;
    clockReadoutEl.textContent = h+':'+m+' '+ap;
  }
  updateClock();
  setInterval(updateClock, 15000);

  const aboutModal = document.getElementById('aboutModal');
  document.getElementById('aboutBtn').addEventListener('click', function(){ aboutModal.classList.add('open'); });
  document.getElementById('aboutModalClose').addEventListener('click', function(){ aboutModal.classList.remove('open'); });
  aboutModal.addEventListener('click', function(e){ if (e.target===aboutModal) aboutModal.classList.remove('open'); });

  document.getElementById('resetAllBtn').addEventListener('click', function(){
    const ok = window.confirm('Reset ALL course data? This deletes every note and order every student has entered for every patient in this browser, and restores all charts to their original seeded state. This cannot be undone.');
    if (!ok) return;
    resetAllData();
    if (viewChart.classList.contains('active') && STATE.currentPatientId){
      setActiveTab(STATE.currentTab);
    }
    renderPatientList();
  });

  /* ---------------------------------------------------------------
     INIT
  --------------------------------------------------------------- */
  document.addEventListener('click', function(){
    const openList = document.querySelector('.newnote-list.open');
    if (openList) openList.classList.remove('open');
  });

  /* Original bootstrap was three synchronous calls (initState(),
     renderPatientList(), setInterval(tickOrders,...)) run the instant
     PATIENTS was available, since it used to be a literal assigned at
     parse time. Loading it is now async, so the same three calls are
     wrapped in startApp() and only run once PATIENTS is actually
     populated — identical behavior, just deferred until data is ready. */
  function startApp(){
    initState();
    renderPatientList();
    setInterval(tickOrders, 1000);
  }

  loadPatientData().then(function(patients){
    PATIENTS = patients;
    startApp();
  });

})();