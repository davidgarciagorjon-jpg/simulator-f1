import { standings } from './state.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rnd = (min, max) => min + Math.random() * (max - min);
const pick = list => list[Math.floor(Math.random() * list.length)];
const findDriver = (s, id) => s.drivers.find(d => d.id === id);
const findTeam = (s, id) => s.teams.find(t => t.id === id) || s.teams[0];

function addEvent(s, text, title = 'Race Control') {
  const x = s.session;
  if (!x) return;
  const event = { lap: x.lap, text };
  x.events.unshift(event);
  x.events = x.events.slice(0, 80);
  s.news.unshift({ title: `${title} · vuelta ${x.lap}`, body: text });
  s.news = s.news.slice(0, 40);
}

function circuitPace(team, circuit) {
  const type = circuit?.type || 'balanced';
  let handling = team.traction ?? 80;
  if (type === 'slow') handling = ((team.slow ?? 80) * 0.55) + ((team.traction ?? 80) * 0.25) + ((team.braking ?? 80) * 0.20);
  else if (type === 'fast') handling = ((team.fast ?? 80) * 0.55) + ((team.aero ?? 80) * 0.25) + ((team.topSpeed ?? 80) * 0.20);
  else if (type === 'power') handling = ((team.power ?? 80) * 0.45) + ((team.topSpeed ?? 80) * 0.40) + ((team.aero ?? 80) * 0.15);
  else if (type === 'tyres') handling = ((team.tyres ?? 80) * 0.40) + ((team.aero ?? 80) * 0.25) + ((team.traction ?? 80) * 0.35);
  else handling = ((team.aero ?? 80) * 0.30) + ((team.traction ?? 80) * 0.25) + ((team.power ?? 80) * 0.25) + ((team.braking ?? 80) * 0.20);
  return handling;
}

function compoundFor(type, weather) {
  if (weather !== 'Seco') return 'Intermediate';
  return type === 'Qualifying' ? 'Soft' : pick(['Medium', 'Medium', 'Hard', 'Soft']);
}

export function start(s, type, ci) {
  const circuitIndex = clamp(Number.isFinite(+ci) ? +ci : 0, 0, Math.max(0, s.calendar.length - 1));
  const circuit = s.calendar[circuitIndex] || s.calendar[0] || { name: 'Circuito sin nombre', laps: 20, type: 'balanced' };
  const raceLaps = Math.max(3, Math.min(80, Number(s.settings?.laps) || 20));
  const total = type === 'Race' ? Math.min(circuit.laps || raceLaps, raceLaps)
    : type === 'Sprint' ? Math.min(15, raceLaps)
    : type === 'Qualifying' ? 3 : 5;
  const weather = s.settings?.weather && Math.random() < 0.18 ? 'Lluvia ligera' : 'Seco';
  const temp = Math.round(rnd(23, 39));
  const entries = s.drivers.map(d => {
    const team = findTeam(s, d.teamId);
    return {
      driverId: d.id, teamId: d.teamId, elapsed: 0, last: null, best: null,
      sector1: null, sector2: null, sector3: null, wear: 0, damage: 0,
      energy: 100, fuel: Math.ceil(total * 1.85 + 4), tyre: compoundFor(type, weather),
      pits: 0, status: 'En pista', points: 0, pos: null, penalty: 0,
      paceFactor: rnd(-0.24, 0.24), pitTarget: type === 'Qualifying' ? 999 : Math.max(5, Math.floor(total * rnd(0.38, 0.65))),
      teamReliability: team.reliability ?? 80, fastestLap: false
    };
  });
  s.session = {
    type, ci: circuitIndex, circuit: circuit.name, lap: 0, total,
    weather, temp, entries, events: [], status: 'En curso', safetyCar: false,
    safetyCarLaps: 0, raceControl: 'Salida de boxes', fastestLapDriverId: null,
    startedAt: new Date().toISOString()
  };
  s.phase = `${type} en curso`;
  addEvent(s, `${type}: sesión iniciada en ${circuit.name}. Condiciones: ${weather.toLowerCase()}, ${temp} °C.`, 'Dirección de carrera');
}

function makePitStop(s, e, d, x) {
  const oldTyre = e.tyre;
  e.pits += 1;
  e.elapsed += rnd(19.5, 25.5);
  e.wear = rnd(1, 5);
  e.damage = Math.max(0, e.damage - rnd(0, 3));
  e.fuel = Math.min(x.total - x.lap + 3, e.fuel + Math.ceil((x.total - x.lap) * 1.8));
  e.tyre = x.weather === 'Seco' ? (oldTyre === 'Soft' ? 'Medium' : oldTyre === 'Medium' ? 'Hard' : 'Medium') : 'Intermediate';
  e.pitTarget = x.lap + Math.max(5, Math.floor((x.total - x.lap) * rnd(0.35, 0.6)));
  addEvent(s, `${d.name} entra en boxes. Monta neumáticos ${e.tyre.toLowerCase()} tras ${oldTyre.toLowerCase()} y regresa a pista.`, 'Estrategia');
}

function calculateLap(s, e, x) {
  const d = findDriver(s, e.driverId);
  const t = findTeam(s, e.teamId);
  const c = s.calendar[x.ci] || { type: 'balanced', length: 5.2 };
  if (!d || !t || e.status === 'Abandono') return;

  const car = circuitPace(t, c);
  const driverPace = (d.pace ?? 80) * 0.58 + (d.consistency ?? 80) * 0.22 + (d.experience ?? 70) * 0.12 + (d.morale ?? 75) * 0.08;
  const tyrePenalty = e.tyre === 'Soft' ? e.wear * 0.035 : e.tyre === 'Hard' ? e.wear * 0.022 : e.wear * 0.028;
  const damagePenalty = e.damage * 0.055;
  const fuelPenalty = e.fuel * 0.012;
  const energyBonus = e.energy > 15 ? 0.15 : -0.18;
  const rainPenalty = x.weather === 'Seco' ? 0 : Math.max(0, 4.4 - ((d.wet ?? 75) - 70) * 0.10);
  const safetyPenalty = x.safetyCar ? rnd(17, 25) : 0;
  const trackBase = 79 + ((c.length || 5.2) - 5.2) * 2.0;
  const consistencyNoise = (100 - (d.consistency ?? 80)) / 100;
  let seconds = trackBase - (car - 80) * 0.105 - (driverPace - 80) * 0.095
    + tyrePenalty + damagePenalty + fuelPenalty - energyBonus + rainPenalty
    + rnd(-0.38, 0.38) + e.paceFactor * (1 + consistencyNoise) + safetyPenalty;
  if (e.tyre === 'Intermediate' && x.weather === 'Seco') seconds += 1.5;
  if (e.tyre !== 'Intermediate' && x.weather !== 'Seco') seconds += 2.5;
  if (e.fuel <= 0) {
    seconds += 8;
    e.fuel = 0;
    if (Math.random() < 0.12) {
      e.status = 'Abandono';
      addEvent(s, `${d.name} se queda sin combustible y abandona.`, 'Abandono');
      return;
    }
  } else e.fuel = Math.max(0, e.fuel - 1.8);

  // Small mistakes are more likely with low consistency, damage or wet conditions.
  const mistakeChance = 0.006 + (100 - (d.consistency ?? 80)) * 0.00022 + e.damage * 0.00025 + (x.weather === 'Seco' ? 0 : 0.012);
  if (!x.safetyCar && Math.random() < mistakeChance) {
    const lost = rnd(1.2, 5.5);
    seconds += lost;
    if (Math.random() < 0.16) {
      e.damage = clamp(e.damage + rnd(8, 22), 0, 100);
      addEvent(s, `${d.name} comete un error y golpea ligeramente el coche. Daños: ${Math.round(e.damage)}%.`, 'Incidente');
    } else if (Math.random() < 0.35) {
      addEvent(s, `${d.name} bloquea neumáticos y pierde tiempo en la vuelta ${x.lap}.`, 'Radio');
    }
  }

  e.last = Math.max(45, seconds);
  e.best = e.best === null ? e.last : Math.min(e.best, e.last);
  e.sector1 = e.last * rnd(0.27, 0.34);
  e.sector2 = e.last * rnd(0.29, 0.36);
  e.sector3 = Math.max(0, e.last - e.sector1 - e.sector2);
  e.elapsed += e.last;
  e.wear = clamp(e.wear + rnd(1.4, 3.1) * (x.weather === 'Seco' ? 1 : 0.72) * (t.tyres ? 1.15 - t.tyres / 250 : 0.83), 0, 100);
  e.energy = clamp(e.energy - rnd(4.5, 8.5), 0, 100);
  if (e.energy < 25 && Math.random() < 0.45) e.energy = clamp(e.energy + rnd(5, 12), 0, 100);

  // Mechanical failures depend on reliability, damage and session duration.
  const failureChance = 0.0008 + (100 - (t.reliability ?? 80)) * 0.000075 + e.damage * 0.000018;
  if (Math.random() < failureChance) {
    e.status = 'Abandono';
    addEvent(s, `${d.name} abandona por un problema mecánico. El equipo investiga la fiabilidad del coche.`, 'Abandono');
    return;
  }

  // Strategy: pit for worn tyres or near the planned stop window.
  if (x.type !== 'Qualifying' && !x.safetyCar && e.pits < 3 && x.lap < x.total - 1) {
    const due = x.lap >= e.pitTarget;
    const worn = e.wear >= 78;
    const wetMismatch = (x.weather !== 'Seco' && e.tyre !== 'Intermediate') || (x.weather === 'Seco' && e.tyre === 'Intermediate');
    if ((due || worn || wetMismatch) && Math.random() < (wetMismatch ? 0.88 : worn ? 0.72 : 0.55)) makePitStop(s, e, d, x);
  }
}

export function lap(s) {
  const x = s.session;
  if (!x || x.status !== 'En curso') return;
  x.lap += 1;

  if (x.safetyCar) {
    x.safetyCarLaps -= 1;
    if (x.safetyCarLaps <= 0) {
      x.safetyCar = false;
      addEvent(s, 'El Safety Car entra en boxes. Dirección de carrera autoriza la reanudación.', 'Race Control');
    }
  } else if (x.type !== 'Qualifying' && Math.random() < (x.weather === 'Seco' ? 0.0035 : 0.008)) {
    x.safetyCar = true;
    x.safetyCarLaps = Math.floor(rnd(1, 3));
    addEvent(s, 'Safety Car desplegado tras un incidente. Los coches reducen el ritmo y se agrupan.', 'Race Control');
  }

  for (const e of x.entries) calculateLap(s, e, x);

  if (s.settings?.weather && Math.random() < (x.weather === 'Seco' ? 0.012 : 0.045)) {
    x.weather = x.weather === 'Seco' ? 'Lluvia ligera' : 'Seco';
    addEvent(s, x.weather === 'Seco'
      ? 'La pista empieza a secarse. Los equipos valoran volver a neumáticos de seco.'
      : 'Empieza a caer lluvia ligera. Los equipos revisan la estrategia de neumáticos.', 'Meteorología');
  }

  x.entries.sort((a, b) => {
    const aOut = a.status === 'Abandono' ? 1 : 0;
    const bOut = b.status === 'Abandono' ? 1 : 0;
    return aOut - bOut || a.elapsed - b.elapsed;
  });
  x.entries.forEach((e, i) => { e.pos = i + 1; });

  const quickest = x.entries.filter(e => e.status !== 'Abandono' && e.last !== null).sort((a, b) => a.last - b.last)[0];
  if (quickest && (!x.fastestLap || quickest.last < x.fastestLap.time)) {
    x.fastestLap = { driverId: quickest.driverId, time: quickest.last, lap: x.lap };
  }

  if (x.lap >= x.total || x.entries.every(e => e.status === 'Abandono')) finish(s);
}

export function finish(s) {
  const x = s.session;
  if (!x || x.status !== 'En curso') return;
  x.status = 'Finalizada';
  x.entries.sort((a, b) => {
    const aOut = a.status === 'Abandono' ? 1 : 0;
    const bOut = b.status === 'Abandono' ? 1 : 0;
    return aOut - bOut || a.elapsed - b.elapsed;
  });
  x.entries.forEach((e, i) => {
    e.pos = i + 1;
    if (e.status !== 'Abandono') e.status = 'Clasificado';
  });

  if (['Race', 'Sprint'].includes(x.type)) {
    const points = x.type === 'Race' ? (s.racePoints || []) : (s.sprintPoints || []);
    x.entries.forEach((e, i) => {
      if (e.status === 'Abandono') return;
      const d = findDriver(s, e.driverId);
      if (!d) return;
      d.points = (d.points || 0) + (points[i] || 0);
      if (i === 0) d.wins = (d.wins || 0) + 1;
      if (i < 3) d.podiums = (d.podiums || 0) + 1;
    });
    if (s.calendar[x.ci]) s.calendar[x.ci].completed = true;
    s.round = Math.max(s.round || 0, x.ci + 1);
  }

  const winner = x.entries.find(e => e.status !== 'Abandono');
  const winnerDriver = winner ? findDriver(s, winner.driverId) : null;
  s.history.unshift({
    season: s.season, type: x.type, circuit: x.circuit,
    winner: winner?.driverId || null,
    entries: x.entries.map(e => ({ ...e })), date: new Date().toISOString(),
    weather: x.weather, laps: x.lap, fastestLap: x.fastestLap || null
  });
  s.history = s.history.slice(0, 100);
  s.phase = `${x.type} finalizada`;
  addEvent(s, winnerDriver ? `Bandera a cuadros. ${winnerDriver.name} termina en primera posición.` : 'Bandera a cuadros. No hay pilotos clasificados.', 'Final de sesión');
  s.news.unshift({ title: `${x.type} finalizada · ${x.circuit}`, body: winnerDriver ? `Victoria de ${winnerDriver.name}. Resultados registrados en el historial.` : 'Resultados registrados en el historial de la temporada.' });
  standings(s);
}

export function runAll(s) {
  let safety = 0;
  while (s.session?.status === 'En curso' && safety < 100) {
    lap(s);
    safety += 1;
  }
}
