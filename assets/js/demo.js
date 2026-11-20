/*
 * The playable level on the home page.
 *
 * The scoring below is a port of the game's own rules (lib/src/puzzle in the
 * app), so the numbers a visitor sees here are the numbers the game gives.
 * The same file runs under Node for tests: the engine is exported and the
 * page code at the bottom only runs in a browser.
 */
(function (root) {
  'use strict';

  // --- Rules -----------------------------------------------------------------

  var NAMES = {
    H: 'Home', P: 'Park', S: 'Solar', W: 'Pump', F: 'Factory',
    R: 'Recycling', T: 'Transit hub', A: 'Arcology', C: 'Coal plant'
  };
  var COST_FIRST = { H: 5, P: 3, S: 8, W: 8, F: 10, R: 15, T: 15, A: 50, C: 0 };
  var COST_STEP = { H: 1, P: 1, S: 2, W: 2, F: 15, R: 10, T: 5, A: 25, C: 0 };

  function rulesFor(mods) {
    var has = function (m) { return !!mods && mods.indexOf(m) !== -1; };
    return {
      homeCapacity: has('high_density') ? 140 : 100,
      homePower: has('high_density') ? 2 : 1,
      homeWater: 1,
      minHomeCapacity: 20,
      parkBonus: has('urban_planning') ? 60 : 40,
      transitBonus: 40,
      industryPenalty: 40,
      solarPower: has('solar_farms') ? 8 : 5,
      pumpWater: 4,
      pumpWaterBesideRiver: 8,
      pumpPower: 2,
      factoryPower: 3,
      factoryWater: 1,
      factoryBlocks: 40,
      factorySmog: 2,
      recyclerPower: 2,
      recyclerBlocks: 20,
      recyclerCleanup: 2,
      transitPower: 1,
      arcologyCapacity: 500,
      arcologyPower: 6,
      arcologyWater: 5,
      coalPower: 12,
      coalSmog: 3,
      toxicSmog: 1,
      smogPercentPerPoint: has('heavy_smog') ? 10 : 5
    };
  }

  /** Cost of the nth copy (1-based) of a building. */
  function costOfNth(code, n) { return COST_FIRST[code] + COST_STEP[code] * (n - 1); }

  function totalCost(code, count) {
    return count * COST_FIRST[code] + COST_STEP[code] * Math.floor(count * (count - 1) / 2);
  }

  function blocksYield(code, rules) {
    return code === 'F' ? rules.factoryBlocks : code === 'R' ? rules.recyclerBlocks : 0;
  }

  /** Turns level JSON (as shipped in the game) into flat arrays. */
  function prepare(json) {
    var w = json.size[0], h = json.size[1], n = w * h;
    var terrain = [], fixed = [], nbr = [], i, x, y;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        terrain.push(json.terrain[y].charAt(x));
        var f = json.fixed ? json.fixed[y].charAt(x) : '.';
        fixed.push(f === '.' ? '' : f);
      }
    }
    for (i = 0; i < n; i++) {
      x = i % w; y = Math.floor(i / w);
      var list = [];
      if (y > 0) list.push(i - w);
      if (x > 0) list.push(i - 1);
      if (x < w - 1) list.push(i + 1);
      if (y < h - 1) list.push(i + w);
      nbr.push(list);
    }
    return {
      id: json.id, name: json.name || json.id, w: w, h: h, n: n,
      terrain: terrain, fixed: fixed, nbr: nbr,
      blocks: json.blocks, palette: json.palette.split(''),
      limits: json.limits || {}, rules: rulesFor(json.mods),
      stars: json.stars || [0, 0, 0],
      best: json.best ? json.best.score : 0
    };
  }

  function isFree(level, i) {
    var t = level.terrain[i];
    return (t === '.' || t === 'x') && !level.fixed[i];
  }

  /** "H..H./..W../....." to a flat array of building codes ('' is empty). */
  function decodeBoard(level, text) {
    var cells = text.split('/').join('').split('');
    for (var i = 0; i < cells.length; i++) if (cells[i] === '.') cells[i] = '';
    return cells;
  }

  /** Scores a board. `cells` holds only the player's buildings. */
  function score(level, cells) {
    var r = level.rules, n = level.n, nbr = level.nbr, fixed = level.fixed;
    var at = function (i) { return fixed[i] || cells[i] || ''; };
    var parksBeside = function (i) {
      var p = 0;
      for (var k = 0; k < nbr[i].length; k++) if (at(nbr[i][k]) === 'P') p++;
      return p;
    };

    var counts = {}, capacity = [], served = [], residents = [];
    var badPlacement = false, notInPalette = false;
    var pSupply = 0, wSupply = 0, infraP = 0, infraW = 0;
    var yieldBlocks = 0, rawSmog = 0, cleanup = 0, i, k, e;

    for (i = 0; i < n; i++) {
      capacity.push(0);
      served.push(false);
      var own = cells[i];
      if (own) {
        if (!isFree(level, i)) badPlacement = true;
        if (level.palette.indexOf(own) === -1) notInPalette = true;
        counts[own] = (counts[own] || 0) + 1;
      }
      var b = at(i);
      if (!b || b === 'P') continue;
      if (b === 'H') {
        var park = 0, transit = 0, industry = 0;
        for (k = 0; k < nbr[i].length; k++) {
          var nb = at(nbr[i][k]);
          if (nb === 'P') park = 1;
          else if (nb === 'T') transit++;
          else if (nb === 'F' || nb === 'C') industry++;
        }
        var cap = r.homeCapacity + park * r.parkBonus + transit * r.transitBonus -
          industry * r.industryPenalty;
        capacity[i] = Math.max(cap, r.minHomeCapacity);
        residents.push(i);
      } else if (b === 'A') {
        capacity[i] = r.arcologyCapacity;
        residents.push(i);
      } else if (b === 'S') {
        pSupply += r.solarPower;
      } else if (b === 'W') {
        var river = false;
        for (k = 0; k < nbr[i].length; k++) if (level.terrain[nbr[i][k]] === '~') river = true;
        wSupply += river ? r.pumpWaterBesideRiver : r.pumpWater;
        infraP += r.pumpPower;
      } else if (b === 'F') {
        infraP += r.factoryPower;
        infraW += r.factoryWater;
        yieldBlocks += r.factoryBlocks;
        e = r.factorySmog - parksBeside(i);
        if (e > 0) rawSmog += e;
      } else if (b === 'R') {
        infraP += r.recyclerPower;
        yieldBlocks += r.recyclerBlocks;
        cleanup += r.recyclerCleanup;
      } else if (b === 'T') {
        infraP += r.transitPower;
      } else if (b === 'C') {
        pSupply += r.coalPower;
        e = r.coalSmog - parksBeside(i);
        if (e > 0) rawSmog += e;
      }
    }

    for (i = 0; i < n; i++) {
      if (level.terrain[i] !== 'x') continue;
      if (at(i) === 'P' || parksBeside(i) > 0) continue;
      rawSmog += r.toxicSmog;
    }
    var smog = Math.max(rawSmog - cleanup, 0);

    // Biggest homes are supplied first; ties go to the lowest tile.
    residents.sort(function (a, b2) { return capacity[b2] - capacity[a] || a - b2; });
    var availP = pSupply - infraP, availW = wSupply - infraW;
    var resP = 0, resW = 0, servedCap = 0;
    for (k = 0; k < residents.length; k++) {
      var idx = residents[k], arc = at(idx) === 'A';
      var dp = arc ? r.arcologyPower : r.homePower;
      var dw = arc ? r.arcologyWater : r.homeWater;
      resP += dp;
      resW += dw;
      if (availP >= dp && availW >= dw) {
        availP -= dp;
        availW -= dw;
        served[idx] = true;
        servedCap += capacity[idx];
      }
    }

    var keep = Math.max(100 - r.smogPercentPerPoint * smog, 0);
    var spent = 0, overLimit = false;
    for (var code in counts) {
      if (level.limits[code] !== undefined && counts[code] > level.limits[code]) overLimit = true;
      spent += totalCost(code, counts[code]);
    }
    var budget = level.blocks + yieldBlocks;

    return {
      population: Math.floor(servedCap * keep / 100),
      powerSupply: pSupply, powerDemand: infraP + resP,
      waterSupply: wSupply, waterDemand: infraW + resW,
      smog: smog, blocksBudget: budget, blocksSpent: spent,
      blocksRemaining: budget - spent,
      capacity: capacity, served: served, counts: counts,
      overBudget: spent > budget, overLimit: overLimit,
      notInPalette: notInPalette, badPlacement: badPlacement,
      valid: !(spent > budget || overLimit || notInPalette || badPlacement)
    };
  }

  function starsFor(level, population) {
    var s = 0;
    for (var i = 0; i < level.stars.length; i++) {
      if (level.stars[i] > 0 && population >= level.stars[i]) s++;
    }
    return s;
  }

  // --- One level being played --------------------------------------------------

  function Session(level, startCells) {
    this.level = level;
    this.start = startCells ? startCells.slice() : null;
    this.cells = [];
    this.undoStack = [];
    for (var i = 0; i < level.n; i++) this.cells.push(startCells ? startCells[i] : '');
    this.result = score(level, this.cells);
  }

  Session.prototype.countOf = function (code) { return this.result.counts[code] || 0; };

  Session.prototype.nextCost = function (code) { return costOfNth(code, this.countOf(code) + 1); };

  Session.prototype.at = function (i) { return this.level.fixed[i] || this.cells[i] || ''; };

  /** 'ok', or why the move is refused. */
  Session.prototype.check = function (i, code) {
    var level = this.level;
    if (i < 0 || i >= level.n) return 'notBuildable';
    if (level.fixed[i]) return 'fixed';
    if (level.terrain[i] !== '.' && level.terrain[i] !== 'x') return 'notBuildable';
    var prev = this.cells[i];
    if (prev === code) return 'noChange';
    this.cells[i] = code;
    var r = score(level, this.cells);
    this.cells[i] = prev;
    if (r.notInPalette) return 'notInPalette';
    if (r.overLimit) return 'limitReached';
    if (r.overBudget) {
      return prev && blocksYield(prev, level.rules) > 0 ? 'budgetDependsOnIt' : 'overBudget';
    }
    return 'ok';
  };

  Session.prototype.apply = function (i, code) {
    var check = this.check(i, code);
    if (check !== 'ok') return check;
    this.undoStack.push([i, this.cells[i]]);
    this.cells[i] = code;
    this.result = score(this.level, this.cells);
    return 'ok';
  };

  Session.prototype.undo = function () {
    var last = this.undoStack.pop();
    if (!last) return false;
    this.cells[last[0]] = last[1];
    this.result = score(this.level, this.cells);
    return true;
  };

  Session.prototype.reset = function (toStart) {
    this.undoStack = [];
    for (var i = 0; i < this.level.n; i++) {
      this.cells[i] = toStart && this.start ? this.start[i] : '';
    }
    this.result = score(this.level, this.cells);
  };

  Session.prototype.canAfford = function (code) {
    var level = this.level;
    if (level.palette.indexOf(code) === -1) return false;
    if (level.limits[code] !== undefined && this.countOf(code) >= level.limits[code]) return false;
    return this.nextCost(code) <= this.result.blocksRemaining + blocksYield(code, level.rules);
  };

  // --- Words -------------------------------------------------------------------

  function describe(code, r) {
    switch (code) {
      case 'H': return 'Houses ' + r.homeCapacity + '. Needs ' + r.homePower + ' power and ' +
        r.homeWater + ' water, or it stays empty.';
      case 'P': return '+' + r.parkBonus + ' people in each home beside it.';
      case 'S': return '+' + r.solarPower + ' power.';
      case 'W': return '+' + r.pumpWater + ' water, or +' + r.pumpWaterBesideRiver +
        ' beside a river. Uses ' + r.pumpPower + ' power.';
      default: return '';
    }
  }

  var REFUSALS = {
    notBuildable: 'Nothing can be built there.',
    fixed: 'That building is part of the level.',
    notInPalette: 'That building is not available here.',
    limitReached: 'No more of those allowed on this level.',
    overBudget: 'Not enough blocks.',
    budgetDependsOnIt: 'The rest of your city is paid for with the blocks this adds. ' +
      'Remove something else first.'
  };

  function plural(n, one, many) { return n === 1 ? '1 ' + one : n + ' ' + many; }

  /** The one most useful thing to say about the board as it stands. */
  function advise(session) {
    var level = session.level, r = session.result, rules = level.rules;
    var homes = 0, emptyHomes = 0, placed = 0, homeWithoutPark = false, i, k;
    for (i = 0; i < level.n; i++) {
      var b = session.at(i);
      if (!b) continue;
      if (!level.fixed[i]) placed++;
      if (b === 'H' || b === 'A') {
        homes++;
        if (!r.served[i]) emptyHomes++;
      }
      if (b === 'H') {
        var park = false;
        for (k = 0; k < level.nbr[i].length; k++) if (session.at(level.nbr[i][k]) === 'P') park = true;
        if (!park) homeWithoutPark = true;
      }
    }
    if (placed === 0) {
      return 'Pick a building below, then tap a tile. Homes fill with people once the city ' +
        'has power and water.';
    }
    if (homes === 0) {
      return 'Now add homes. Each one houses ' + rules.homeCapacity + ' people once it has ' +
        'power and water.';
    }
    if (emptyHomes > 0) {
      var lacksPower = r.powerDemand > r.powerSupply, lacksWater = r.waterDemand > r.waterSupply;
      var who = plural(emptyHomes, 'home is', 'homes are') + ' empty';
      var fix = function (code, noun) {
        return session.canAfford(code) ? 'Add ' + noun + '.'
          : 'You cannot afford ' + noun + ': take back a home to free blocks.';
      };
      if (lacksPower && lacksWater) {
        return who + ': the city is short of both power and water. Add solar and a pump.';
      }
      if (lacksWater) {
        return who + ': the city needs ' + r.waterDemand + ' water and makes ' + r.waterSupply +
          '. ' + fix('W', 'a pump');
      }
      return who + ': the city needs ' + r.powerDemand + ' power and makes ' + r.powerSupply +
        '. ' + fix('S', 'solar');
    }
    if (r.smog > 0) {
      return 'Smog is driving out ' + Math.min(r.smog * rules.smogPercentPerPoint, 100) +
        '% of your people. Put parks beside whatever is making it.';
    }
    var stars = starsFor(level, r.population);
    if (stars === 3) {
      return level.best > 0 && r.population >= level.best
        ? 'Three stars, and you matched the best known city.'
        : 'Three stars! The best known city houses ' + level.best + '.';
    }
    var nextStar = level.stars[stars] - r.population;
    var canBuild = false;
    for (i = 0; i < level.palette.length; i++) if (session.canAfford(level.palette[i])) canBuild = true;
    if (!canBuild) {
      return 'Out of blocks, ' + nextStar + ' people short of the next star. Take a building ' +
        'back for a full refund and try another spot.';
    }
    if (session.canAfford('P') && homeWithoutPark) {
      return nextStar + ' more people to the next star. A park adds ' + rules.parkBonus +
        ' people to every home beside it.';
    }
    return nextStar + ' more people to the next star. More homes need more power and water ' +
      'to match.';
  }

  var engine = {
    prepare: prepare, score: score, starsFor: starsFor, decodeBoard: decodeBoard,
    Session: Session, advise: advise, costOfNth: costOfNth, totalCost: totalCost
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  if (!root || !root.document) return;

  // --- The page ----------------------------------------------------------------

  // Foundations 3, exactly as it ships in the game.
  var LEVEL_JSON = {
    id: 'c1-03', name: 'Foundations 3', size: [5, 5],
    terrain: ['.....', '.....', '.....', '.....', '.....'],
    blocks: 70, palette: 'HSWP', stars: [336, 448, 532], best: { score: 560 }
  };
  // Four homes with power and water, and one obvious thing missing.
  var START = '...../..H../.H.H./..H../SS.W.';
  var HINT_TILE = 12;

  var doc = root.document;
  var mount = doc.getElementById('demo');
  if (!mount) return;

  var level = prepare(LEVEL_JSON);
  var session = new Session(level, decodeBoard(level, START));
  var tool = 'P';
  var touched = false;
  var solvedOnce = false;
  var refusal = '';
  var refusalTimer = 0;
  var reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var SVG = 'http://www.w3.org/2000/svg';
  function icon(id, cls) {
    var svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    var use = doc.createElementNS(SVG, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  // Static frame, built once.
  mount.textContent = '';
  mount.classList.add('demo-ready');

  var bar = el('div', 'demo-bar');
  var title = el('div', 'demo-title');
  title.appendChild(el('span', 'demo-level', level.name));
  title.appendChild(el('span', 'demo-tag', 'Playable'));
  var restart = el('button', 'demo-ghost', 'Start over');
  restart.type = 'button';
  bar.appendChild(title);
  bar.appendChild(restart);

  var scoreRow = el('div', 'demo-score');
  var popWrap = el('div', 'demo-pop');
  var popNum = el('span', 'demo-pop-num', '0');
  popWrap.appendChild(popNum);
  popWrap.appendChild(el('span', 'demo-pop-unit', 'people'));
  var starWrap = el('div', 'demo-stars');
  var starRow = el('div', 'demo-star-row');
  var starEls = [];
  for (var s = 0; s < 3; s++) {
    var st = icon('i-star', 'demo-star');
    starEls.push(st);
    starRow.appendChild(st);
  }
  var starNote = el('div', 'demo-star-note');
  starWrap.appendChild(starRow);
  starWrap.appendChild(starNote);
  scoreRow.appendChild(popWrap);
  scoreRow.appendChild(starWrap);

  var meter = el('div', 'demo-meter');
  var meterFill = el('div', 'demo-meter-fill');
  meter.appendChild(meterFill);

  var readouts = el('div', 'demo-readouts');
  function readout(label) {
    var box = el('div', 'demo-readout');
    box.appendChild(el('span', 'demo-readout-label', label));
    var value = el('span', 'demo-readout-value');
    box.appendChild(value);
    readouts.appendChild(box);
    return { box: box, value: value };
  }
  var powerOut = readout('Power used');
  var waterOut = readout('Water used');
  var blocksOut = readout('Blocks left');

  var advice = el('p', 'demo-advice');
  advice.setAttribute('aria-live', 'polite');

  var board = el('div', 'demo-board');
  board.style.setProperty('--cols', level.w);
  board.setAttribute('role', 'group');
  board.setAttribute('aria-label', level.name + ' board, ' + level.w + ' by ' + level.h + ' tiles');
  var tiles = [];
  for (var t = 0; t < level.n; t++) {
    var cell = el('button', 'demo-tile');
    cell.type = 'button';
    cell.setAttribute('data-i', t);
    if ((t % level.w + Math.floor(t / level.w)) % 2) cell.classList.add('alt');
    tiles.push(cell);
    board.appendChild(cell);
  }
  var confetti = el('div', 'demo-confetti');
  confetti.setAttribute('aria-hidden', 'true');
  var boardWrap = el('div', 'demo-board-wrap');
  boardWrap.appendChild(board);
  boardWrap.appendChild(confetti);

  var actions = el('div', 'demo-actions');
  var undoBtn = el('button', 'demo-ghost', 'Undo');
  undoBtn.type = 'button';
  var removeBtn = el('button', 'demo-ghost', 'Remove');
  removeBtn.type = 'button';
  var toolNote = el('p', 'demo-tool-note');
  actions.appendChild(toolNote);
  actions.appendChild(undoBtn);
  actions.appendChild(removeBtn);

  var palette = el('div', 'demo-palette');
  palette.setAttribute('role', 'group');
  palette.setAttribute('aria-label', 'Buildings');
  var paletteBtns = {};
  level.palette.forEach(function (code) {
    var b = el('button', 'demo-tool');
    b.type = 'button';
    b.setAttribute('data-tool', code);
    b.appendChild(icon('b-' + code, 'demo-tool-icon'));
    b.appendChild(el('span', 'demo-tool-name', NAMES[code]));
    var cost = el('span', 'demo-tool-cost');
    b.appendChild(cost);
    var count = el('span', 'demo-tool-count');
    b.appendChild(count);
    paletteBtns[code] = { btn: b, cost: cost, count: count };
    palette.appendChild(b);
  });

  var after = el('p', 'demo-after');
  after.hidden = true;

  [bar, scoreRow, meter, readouts, advice, boardWrap, actions, palette, after].forEach(function (n) {
    mount.appendChild(n);
  });

  function tileLabel(i) {
    var r = session.result, b = session.at(i);
    var where = 'Row ' + (Math.floor(i / level.w) + 1) + ', column ' + (i % level.w + 1) + ': ';
    if (!b) return where + 'empty';
    if (b === 'H') return where + (r.served[i] ? 'home, houses ' + r.capacity[i] : 'home, empty');
    return where + NAMES[b].toLowerCase();
  }

  function render() {
    var r = session.result, rules = level.rules;
    var stars = starsFor(level, r.population);

    popNum.textContent = r.population;
    starEls.forEach(function (node, k) { node.classList.toggle('on', k < stars); });
    starNote.textContent = stars < 3 ? 'Next star at ' + level.stars[stars]
      : 'Best known: ' + level.best;
    meterFill.style.width = Math.min(100, Math.round(100 * r.population / level.best)) + '%';

    powerOut.value.textContent = r.powerDemand + ' of ' + r.powerSupply;
    powerOut.box.classList.toggle('short', r.powerDemand > r.powerSupply);
    waterOut.value.textContent = r.waterDemand + ' of ' + r.waterSupply;
    waterOut.box.classList.toggle('short', r.waterDemand > r.waterSupply);
    blocksOut.value.textContent = r.blocksRemaining + ' of ' + r.blocksBudget;

    advice.textContent = refusal || advise(session);
    advice.classList.toggle('refused', !!refusal);

    tiles.forEach(function (cell, i) {
      var b = session.at(i);
      var key = b + '|' + (b === 'H' ? r.capacity[i] + (r.served[i] ? 's' : 'e') : '');
      if (cell.getAttribute('data-key') !== key) {
        cell.setAttribute('data-key', key);
        cell.textContent = '';
        if (b) {
          var svg = icon('b-' + b, 'demo-building');
          cell.appendChild(svg);
          if (b === 'H') {
            var served = r.served[i], cap = r.capacity[i];
            var pill = el('span', 'demo-cap', served ? String(cap) : 'empty');
            if (!served) pill.classList.add('empty');
            else if (cap > rules.homeCapacity) pill.classList.add('up');
            else if (cap < rules.homeCapacity) pill.classList.add('down');
            cell.appendChild(pill);
            cell.classList.toggle('unserved', !served);
          } else {
            cell.classList.remove('unserved');
          }
        } else {
          cell.classList.remove('unserved');
        }
      }
      cell.setAttribute('aria-label', tileLabel(i));
      cell.classList.toggle('hint', !touched && i === HINT_TILE);
    });

    level.palette.forEach(function (code) {
      var p = paletteBtns[code];
      var selected = tool === code;
      p.btn.classList.toggle('selected', selected);
      p.btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
      p.cost.textContent = session.nextCost(code) + ' blocks';
      var count = session.countOf(code);
      p.count.textContent = count || '';
      p.count.hidden = !count;
      p.btn.classList.toggle('dear', !session.canAfford(code));
    });
    removeBtn.classList.toggle('selected', tool === '');
    removeBtn.setAttribute('aria-pressed', tool === '' ? 'true' : 'false');
    undoBtn.disabled = session.undoStack.length === 0;
    toolNote.textContent = tool ? NAMES[tool] + ': ' + describe(tool, rules)
      : 'Remove: tap a building to take it back for a full refund.';

    var solved = stars === 3 && r.population >= level.best;
    if (solved && !solvedOnce) {
      solvedOnce = true;
      celebrate();
      after.textContent = 'That is Foundations 3 solved. The game has 35 more free levels, ' +
        'and a new city every morning.';
      after.hidden = false;
    }
  }

  function celebrate() {
    starRow.classList.remove('pop');
    void starRow.offsetWidth;
    starRow.classList.add('pop');
    if (reducedMotion) return;
    var colours = ['#00E5A0', '#FFD54F', '#4F8FE8', '#FF8A80', '#ffffff', '#8A68CF'];
    confetti.textContent = '';
    for (var i = 0; i < 44; i++) {
      var bit = el('i');
      bit.style.left = (4 + Math.random() * 92) + '%';
      bit.style.background = colours[i % colours.length];
      bit.style.animationDelay = (Math.random() * 0.35) + 's';
      bit.style.animationDuration = (1.5 + Math.random() * 1.1) + 's';
      bit.style.setProperty('--drift', (Math.random() * 80 - 40) + 'px');
      bit.style.setProperty('--spin', (Math.random() * 720 - 360) + 'deg');
      confetti.appendChild(bit);
    }
    root.setTimeout(function () { confetti.textContent = ''; }, 3200);
  }

  function refuse(check, cell) {
    refusal = REFUSALS[check] || '';
    root.clearTimeout(refusalTimer);
    refusalTimer = root.setTimeout(function () { refusal = ''; render(); }, 2600);
    if (cell && !reducedMotion) {
      cell.classList.remove('shake');
      void cell.offsetWidth;
      cell.classList.add('shake');
    }
  }

  board.addEventListener('click', function (event) {
    var cell = event.target.closest ? event.target.closest('.demo-tile') : null;
    if (!cell) return;
    var i = Number(cell.getAttribute('data-i'));
    var current = session.cells[i];
    // Tapping a building with its own tool takes it back, as in the game.
    var code = tool === '' || current === tool ? '' : tool;
    if (code === '' && !current) return;
    var check = session.apply(i, code);
    touched = true;
    refusal = '';
    if (check !== 'ok' && check !== 'noChange') refuse(check, cell);
    else if (code && !reducedMotion) {
      root.requestAnimationFrame(function () {
        var svg = cell.querySelector('.demo-building');
        if (svg) svg.classList.add('placed');
      });
    }
    render();
  });

  palette.addEventListener('click', function (event) {
    var btn = event.target.closest ? event.target.closest('.demo-tool') : null;
    if (!btn) return;
    tool = btn.getAttribute('data-tool');
    render();
  });

  removeBtn.addEventListener('click', function () {
    tool = tool === '' ? level.palette[0] : '';
    render();
  });

  undoBtn.addEventListener('click', function () {
    session.undo();
    refusal = '';
    render();
  });

  restart.addEventListener('click', function () {
    // The first press clears the prepared city; from an empty board it
    // brings the prepared city back.
    var empty = session.cells.every(function (c) { return !c; });
    session.reset(empty);
    touched = true;
    refusal = '';
    tool = empty ? 'P' : 'H';
    render();
  });

  render();
})(typeof window !== 'undefined' ? window : null);
