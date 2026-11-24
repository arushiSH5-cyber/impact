/*
 * Emission factors for the carbon ledger. Every number has a source.
 * The AI receipt scanner only EXTRACTS line items; all carbon math happens here,
 * on the server (authoritative) and in the browser (preview), with these factors.
 * Bruin recomputes the same math from pipeline/assets/raw/emission_factors.csv and checks it matches.
 */
(function (root) {
  'use strict';

  const SRC = {
    owid: 'Poore & Nemecek (2018) via Our World in Data, kg CO2e per kg food (global average)',
    epa_car: 'US EPA, typical passenger vehicle: 404 g CO2 per mile; 8,887 g CO2 per gallon gasoline',
    epa_elec: 'US EPA GHG Equivalencies Calculator: 0.394 kg CO2 per kWh used',
    epa_gas: 'US EPA GHG Equivalencies Calculator: natural gas ~5.3 kg CO2 per therm',
    epa_water: 'US EPA WaterSense: standard showerhead 2.5 gallons per minute',
    epa_foodwaste: 'US EPA: most landfilled food-waste emissions happen before disposal, so wasted food counts at its full footprint',
    count: 'item count (no CO2 factor applied)',
  };

  // kg CO2e per kg of food (Poore & Nemecek 2018 / OWID)
  const FOOD = {
    beef: 99.48, lamb: 39.72, chocolate: 46.65, coffee: 28.53, prawns: 26.87, cheese: 23.88, fish: 13.63, pork: 12.31,
    chicken: 9.87, eggs: 4.67, rice: 4.45, tofu: 3.16, milk: 3.15, tomatoes: 2.09, beans: 1.79, bread: 1.57,
    peas: 0.98, bananas: 0.86, potatoes: 0.46, apples: 0.43, nuts: 0.43,
  };
  // typical portion per meal in kg (an assumption, shown next to the number in the app)
  const PORTION = { beef: 0.15, lamb: 0.15, prawns: 0.15, fish: 0.15, pork: 0.15, chicken: 0.15, tofu: 0.15, beans: 0.15, cheese: 0.05, eggs: 0.12, rice: 0.1, bread: 0.1, potatoes: 0.25 };

  const CAR_KM = 0.404 / 1.609;       // kg CO2 per km
  const GASOLINE_GAL = 8.887;         // kg CO2 per gallon
  const KWH = 0.394;                  // kg CO2 per kWh
  const THERM = 5.3;                  // kg CO2 per therm
  const SHOWER_L_PER_MIN = 2.5 * 3.785;

  const CATS = {
    food: { name: 'Food', agent: 'mossling', zone: 'forest', unit: 'kg CO₂e' },
    travel: { name: 'Travel & energy', agent: 'frostbun', zone: 'ice', unit: 'kg CO₂e' },
    water: { name: 'Water', agent: 'ripplet', zone: 'ocean', unit: 'L' },
    stuff: { name: 'Stuff & trash', agent: 'sunfox', zone: 'desert', unit: 'items' },
  };
  const KINDS = ['meal', 'grocery', 'food_waste', 'drive', 'gas', 'walk', 'kwh', 'therm', 'shower', 'laundry', 'bottle', 'trash', 'new_clothes', 'takeout', 'refuse'];

  const num = (v, d) => { const n = +v; return isFinite(n) && n >= 0 ? n : d; };
  const food = (f) => (Object.prototype.hasOwnProperty.call(FOOD, f) ? f : null);

  // One raw log item → { cat, kind, key, amount, kg, liters, items, saved, label, src }
  // key + amount are what Bruin multiplies by the factor table to recompute kg.
  function compute(x) {
    x = x || {};
    const q = Math.min(num(x.qty, 0), 1000);
    const r = { kind: x.kind, kg: 0, liters: 0, items: 0, saved: 0, plastic: 0, bags: 0, waste: 0, km: 0, key: '', amount: 0 };
    switch (x.kind) {
      case 'meal': {
        const f = food(x.food);
        if (!f) return Object.assign(r, { cat: 'food', label: `${x.name || x.food || 'meal'}`, src: 'not in the factor table: not counted', skip: true });
        const portion = x.kg != null ? num(x.kg, 0.15) : PORTION[f] || 0.15;
        const n = q || 1;
        return Object.assign(r, { cat: 'food', key: 'food:' + f, amount: portion * n, kg: FOOD[f] * portion * n, label: `${n}× ${f} meal`, src: SRC.owid, note: x.kg != null ? '' : `portion ${Math.round(portion * 1000)} g (assumption)` });
      }
      case 'grocery': {
        const f = food(x.food);
        const kg = num(x.kg, 0);
        if (!f || !kg) return Object.assign(r, { cat: 'food', label: x.name || 'grocery item', src: 'not in the factor table: not counted', skip: true });
        return Object.assign(r, { cat: 'food', key: 'food:' + f, amount: kg, kg: FOOD[f] * kg, label: x.name && /\bkg\b/i.test(x.name) ? x.name : `${x.name || f} ${kg.toFixed(2)} kg`, src: SRC.owid });
      }
      case 'food_waste': {
        const f = food(x.food);
        if (!f) return Object.assign(r, { cat: 'food', label: `threw out ${x.name || x.food || 'food'}`, src: 'not in the factor table: not counted', skip: true });
        const kg = num(x.kg, 0.2) || 0.2;
        return Object.assign(r, { cat: 'food', key: 'food:' + f, amount: kg, kg: FOOD[f] * kg, waste: kg, label: `threw out ${Math.round(kg * 1000)} g ${f}`, src: SRC.owid + ' · ' + SRC.epa_foodwaste });
      }
      case 'drive': return Object.assign(r, { cat: 'travel', key: 'car_km', amount: q, kg: CAR_KM * q, km: q, label: `drove ${q} km`, src: SRC.epa_car });
      case 'gas': return Object.assign(r, { cat: 'travel', key: 'gasoline_gal', amount: q, kg: GASOLINE_GAL * q, label: `${q} gal gasoline`, src: SRC.epa_car });
      case 'walk': return Object.assign(r, { cat: 'travel', key: 'car_km_avoided', amount: q, saved: CAR_KM * q, label: `walked/biked ${q} km instead of driving`, src: SRC.epa_car });
      case 'kwh': return Object.assign(r, { cat: 'travel', key: 'kwh', amount: q, kg: KWH * q, label: `${q} kWh electricity`, src: SRC.epa_elec });
      case 'therm': return Object.assign(r, { cat: 'travel', key: 'therm', amount: q, kg: THERM * q, label: `${q} therms natural gas`, src: SRC.epa_gas });
      case 'shower': return Object.assign(r, { cat: 'water', key: 'shower_min', amount: q, liters: SHOWER_L_PER_MIN * q, label: `${q}-min shower`, src: SRC.epa_water });
      case 'laundry': return Object.assign(r, { cat: 'water', key: 'laundry_load', amount: q || 1, items: 0, label: `${q || 1} laundry load(s)`, src: 'count (water per load varies by machine)' });
      case 'bottle': return Object.assign(r, { cat: 'stuff', key: 'item', amount: q || 1, items: q || 1, plastic: q || 1, label: `${q || 1} plastic bottle(s)`, src: SRC.count });
      case 'takeout': return Object.assign(r, { cat: 'stuff', key: 'item', amount: q || 1, items: q || 1, plastic: q || 1, label: `${q || 1} takeout container(s)`, src: SRC.count });
      case 'trash': return Object.assign(r, { cat: 'stuff', key: 'item', amount: q || 1, items: q || 1, bags: q || 1, label: `${q || 1} trash bag(s)`, src: SRC.count });
      case 'new_clothes': return Object.assign(r, { cat: 'stuff', key: 'item', amount: q || 1, items: q || 1, label: `${q || 1} new clothing item(s)`, src: SRC.count });
      case 'refuse': return Object.assign(r, { cat: 'stuff', key: 'item_avoided', amount: q || 1, savedItems: q || 1, label: `refused ${q || 1} single-use item(s)`, src: SRC.count });
      default: return Object.assign(r, { cat: 'stuff', label: x.name || 'item', src: 'unknown kind: not counted', skip: true });
    }
  }

  root.ImpactFactors = { SRC, FOOD, PORTION, CATS, KINDS, compute, CAR_KM, GASOLINE_GAL, KWH, THERM, SHOWER_L_PER_MIN };
})(typeof module !== 'undefined' ? module.exports : window);
