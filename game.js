/* ============================== SPRITE ART (decorative — not used for battle-map pieces) ============================== */
const SPRITE_BATTLESHIP_ICON = "assets/battleship-icon.png";
const SPRITE_DESTROYER_HERO = "assets/destroyer-hero.png";
const SPRITE_FRIGATE_HERO = "assets/frigate-hero.png";
const SPRITE_FRIGATE_ICON = "assets/frigate-icon.png";
// Fitment hero panel is now ship-type-aware; set per the active tab in renderFitmentScreen().
const SHIP_HERO_IMAGES = { Destroyer: SPRITE_DESTROYER_HERO, Frigate: SPRITE_FRIGATE_HERO };

// Top-down sailing sprite used for Destroyer hulls (both sides) on the actual game board,
// replacing the vector-drawn hull polygon for that ship type. In the sheet's native art the
// bow points toward local -X (left); MAP_SPRITE_BOW_OFFSET rotates that to local -Y (up) to
// match the same "heading 0 = north = local -Y before rotation" convention the vector hulls
// already use (see drawShip), so a single ctx.rotate((heading+offset)) lines it up correctly.
const SPRITE_DESTROYER_MAP_SAILING = "assets/destroyer-map-sailing.png";
const destroyerMapSailingImg = new Image();
destroyerMapSailingImg.src = SPRITE_DESTROYER_MAP_SAILING;
const SPRITE_FRIGATE_MAP_SAILING = "assets/frigate-map-sailing.png";
const frigateMapSailingImg = new Image();
frigateMapSailingImg.src = SPRITE_FRIGATE_MAP_SAILING;
const MAP_SHIP_SPRITES = {
  Destroyer: { img: destroyerMapSailingImg, cellW: 217, cellH: 119, frameCount: 6, fps: 8 },
  Frigate: { img: frigateMapSailingImg, cellW: 189, cellH: 114, frameCount: 6, fps: 8 }
};
const MAP_SPRITE_BOW_OFFSET = 90;
let mapSpriteClock = 0; // seconds, advanced once per render() frame
let mapSpriteLastTime = null;

// Deck-gun firing effect: pops up a small "Firing Window" next to the shooting ship for every
// resolved Cannon shot, staggered 0.5s apart, then all the currently-open windows start their
// 2-second animation together and close together. See resolveAttack() for where shots are
// captured, and flushFiringWindowBatch()/updateFiringWindows() for the batch/animation logic.
const SPRITE_DECKGUN_FIRING = "assets/deckgun-firing.png";
const SPRITE_AUTOGUN_FIRING = "assets/autogun-firing.png";
const SPRITE_TORPEDO_FIRING = "assets/torpedo-firing.png";
const deckgunFiringImg = new Image(); deckgunFiringImg.src = SPRITE_DECKGUN_FIRING;
const torpedoFiringImg = new Image(); torpedoFiringImg.src = SPRITE_TORPEDO_FIRING;
const autogunFiringImg = new Image(); autogunFiringImg.src = SPRITE_AUTOGUN_FIRING;
// Registry of weapon types that get a Firing Window. Add a new entry here (plus its own
// captured shots in resolveAttack()) to extend this to another weapon type later.
const FIRING_WINDOW_WEAPONS = {
  Cannon: { img: deckgunFiringImg, cellW: 216, cellH: 94, frameCount: 16 },
  Autogun: { img: autogunFiringImg, cellW: 156, cellH: 106, frameCount: 12 },
  // Torpedo launch (a Special Attack order in the Special Orders phase): one window per launching ship, not per torpedo — see launchTorpedoes().
  Torpedo: { img: torpedoFiringImg, cellW: 322, cellH: 181, frameCount: 12 }
};
const FIRING_WINDOW_STAGGER_MS = 300, FIRING_WINDOW_PLAY_MS = 2000;
const FIRING_WINDOW_W = 165, FIRING_WINDOW_H = 117; // 220x156 reduced by 25%
// Torpedo lane: it opens out at TORPEDO_ARC_HALF degrees either side of the launching ship's heading
// (7 degrees total) until it is TORPEDO_LANE_MAX_WIDTH inches wide, then carries on at that width, as a
// rectangle, out to the torpedo's full range. One shape, used for the drawn lane, launching, near-miss
// checks and resolving in-flight torpedoes.
const TORPEDO_ARC_HALF = 3.5;
const TORPEDO_LANE_MAX_WIDTH = 15;
const TORPEDO_LANE_MAX_HALF = TORPEDO_LANE_MAX_WIDTH/2;
let pendingGunShots = []; // {shooter, weaponKey} collected during commenceFiring()'s resolution pass
let pendingEffects = []; // {type,x,y} hit/miss effects, held back until the firing-window batch closes
let pendingCrits = [];   // weapon hits that reached a ship's structure this round, awaiting their Critical Damage checks at the end of the Firing phase: {shipId, pct, weaponKey}
let firingWindows = []; // active windows for the current batch: {id, shooter, weaponKey, openDelay, opened, el}
let firingWindowNextId = 1;
let firingBatchStartTime = null; // performance.now() when the current batch was flushed
let firingBatchQueue = []; // batches of shots that arrived while another batch was still playing (e.g. ship-by-ship torpedo launches)

// Bridge-view "ship hit" cinematic: instead of the small on-map explosion, a hit ship gets its
// own window (visually the same as a Firing Window) playing this sequence once, then closing.
// Multiple hits on the SAME ship in one Commence Firing pass still only open one such window —
// one per ship hit this round, not one per shot that landed.
const SPRITE_BRIDGE_HIT = "assets/bridge-hit.jpg";
const bridgeHitImg = new Image();
bridgeHitImg.src = SPRITE_BRIDGE_HIT;
const BRIDGE_HIT_CELL_W = 329, BRIDGE_HIT_CELL_H = 199, BRIDGE_HIT_FRAME_COUNT = 13;
const BRIDGE_HIT_PLAY_MS = 2200;
let hitWindows = []; // {id, target, el, canvasEl} — all open together, no stagger
let hitBatchStartTime = null;

// Miss animations: when a shot misses, its target ship gets the same kind of window, playing
// ONE of these two clips chosen at random (picked fresh per window). Multiple misses against the
// same ship in one round still only open a single window, same dedup rule as hits — and if a
// ship was both hit and missed this round, the hit window wins (nothing lost, just no redundant
// second window for the same ship).
const SPRITE_BRIDGE_MISS = "assets/bridge-miss.jpg";
const SPRITE_SHELL_MISS = "assets/shell-miss.jpg";
const bridgeMissImg = new Image(); bridgeMissImg.src = SPRITE_BRIDGE_MISS;
const shellMissImg = new Image(); shellMissImg.src = SPRITE_SHELL_MISS;
const HIT_WINDOW_SPEC = { img: bridgeHitImg, cellW: BRIDGE_HIT_CELL_W, cellH: BRIDGE_HIT_CELL_H, frameCount: BRIDGE_HIT_FRAME_COUNT };
const MISS_WINDOW_SPECS = [
  { img: bridgeMissImg, cellW: 336, cellH: 196, frameCount: 16 },
  { img: shellMissImg, cellW: 283, cellH: 214, frameCount: 13 }
];
// A ship HIT BY A TORPEDO specifically gets one of these two clips instead of the regular gunfire
// hit window, picked at random per window. If a ship takes both gunfire and torpedo hits in the
// same round it still only gets one window (see releasePendingEffects), and the torpedo clip wins.
const SPRITE_TORPEDO_HIT1 = "assets/torpedo-hit1.jpg";
const SPRITE_TORPEDO_HIT2 = "assets/torpedo-hit2.jpg";
const torpedoHit1Img = new Image(); torpedoHit1Img.src = SPRITE_TORPEDO_HIT1;
const torpedoHit2Img = new Image(); torpedoHit2Img.src = SPRITE_TORPEDO_HIT2;
const TORPEDO_HIT_SPECS = [
  { img: torpedoHit1Img, cellW: 396, cellH: 214, frameCount: 16 },
  { img: torpedoHit2Img, cellW: 350, cellH: 211, frameCount: 16 }
];
// Laying a mine (Special Attack, weaponKey 'Mine') gets its own Firing Window — the bow-forward
// view of the mine settling into the wake. One clip, not a random pair, since only one was supplied.
const SPRITE_MINE_DROP = "assets/mine-drop.jpg";
const mineDropImg = new Image(); mineDropImg.src = SPRITE_MINE_DROP;
const MINE_DROP_SPEC = { img: mineDropImg, cellW: 266, cellH: 212, frameCount: 15 };
FIRING_WINDOW_WEAPONS.Mine = MINE_DROP_SPEC;
// A torpedo that does NOT hit a given ship gets this dedicated near-miss clip (instead of the
// generic MISS_WINDOW_SPECS pair) for every ship the torpedo threatened — see the near-miss
// pass in resolveTorpedoes(). One clip supplied, so no random choice needed here.
const SPRITE_TORPEDO_MISS = "assets/torpedo-miss.jpg";
const torpedoMissImg = new Image(); torpedoMissImg.src = SPRITE_TORPEDO_MISS;
const TORPEDO_MISS_SPEC = { img: torpedoMissImg, cellW: 276, cellH: 184, frameCount: 16 };
// A laid mine's own idle "inspector" clip — not part of the firing/hit/miss batch system at all:
// opened directly by clicking a mine on the map, loops indefinitely, and closes on the next click
// elsewhere (see mineAtScreenPoint / openMineInspector / closeMineInspector / updateMineInspector).
const SPRITE_MINE_WATCH = "assets/mine-watch.jpg";
const mineWatchImg = new Image(); mineWatchImg.src = SPRITE_MINE_WATCH;
const MINE_WATCH_SPEC = { img: mineWatchImg, cellW: 276, cellH: 184, frameCount: 16 };
const MINE_WATCH_LOOP_MS = 2000;
let mineInspectWindow = null; // {mineId, el, canvasEl} or null
let mineInspectClock = 0;
let mineInspectLastTime = null;
// How close (in inches) an enemy ship has to come to a laid mine to set it off. Used both by the
// detonation check and by the dotted trigger ring drawn around each mine, so they always agree.
const MINE_TRIGGER_RANGE = 10;
// Half-width of a turret's firing cone, in degrees (the cone is 25 degrees wide). Used for the firing
// check, the drawn cone, and the "degrees off target" indicator, so they always agree.
const TURRET_CONE_HALF = 12.5;
// --- Critical Damage ---
// Whenever a weapon hit gets through to a ship's STRUCTURE, a D20 is rolled (at the end of the Firing
// phase) against a target number that depends on how much of the ship's ARMOR (all four facings
// together) is left when the hit lands:
const CRIT_THRESHOLDS = [ {minPct:75, needs:16}, {minPct:50, needs:11}, {minPct:25, needs:6} ];
// Below the lowest band the rules don't give a number; the pattern (each band down makes it 25% more likely)
// continues to "every structure hit is a Critical Damage Hit".
const CRIT_BELOW_LOWEST_NEEDS = 1;
// --- AI aggression tuning (torpedoes / mines) ---
const AI_TORPEDO_MAX_RANGE = 450;        // won't fire at targets farther than this (hit chance falls off with distance)
const AI_TORPEDO_COOLDOWN_ROUNDS = 2;    // a ship that has launched waits this many rounds before its next salvo
const AI_MAX_SALVOS_PER_TARGET = 2;      // at most this many AI ships may fire at the same enemy in one phase
const AI_TORPEDO_AIM_CHANCE = 0.45;      // how often a ship with torpedoes ready bothers to steer its bow onto a target at all (0.75 doubled the AI's torpedo hits once it could aim precisely, so this keeps it at its earlier level)
let nextMineId = 1;

// Battle background music: starts the moment the battle actually begins (right when the player
// picks a heading, inside the same click that calls startGame() — playing audio from directly
// inside a user gesture like that is what lets browsers allow it without being blocked as
// autoplay), loops for as long as the battle (and its summary screen) is showing, and stops when
// the player returns to the title screen.
const SOUND_BATTLE_MUSIC = "assets/battle-music.mp3";
const battleMusic = new Audio(SOUND_BATTLE_MUSIC);
battleMusic.loop = true;
battleMusic.volume = 0.5;
// Keep the toggle button's label in sync with ACTUAL playback state at all times — covers every
// way that state can change (autoplay succeeding, autoplay being silently blocked by the browser,
// the player toggling it manually, or it getting paused/reset on returning to the title screen) —
// rather than trying to track each of those separately and risk the button lying about what's
// really happening.
function updateMusicToggleBtn(){
  const b = document.getElementById('musicToggleBtn');
  if(!b) return;
  b.textContent = battleMusic.paused ? '🔈 Music' : '🔊 Music';
}
battleMusic.addEventListener('play', updateMusicToggleBtn);
battleMusic.addEventListener('pause', updateMusicToggleBtn);
document.getElementById('musicToggleBtn').onclick = ()=>{
  if(battleMusic.paused){
    // A direct click like this is a fresh, guaranteed-valid user gesture, so this will start
    // playback even if the earlier automatic attempt (from choosing a heading) was blocked by
    // the browser's autoplay policy.
    battleMusic.play().catch(()=>{ logMsg('sys', "Couldn't start music — your browser blocked it even on a direct click."); });
  } else {
    battleMusic.pause();
  }
}; // registered here so gun-window playback (spec lookup by weaponKey) also covers mines

// Hand-painted island art (20 pieces), used in place of the old procedural green-blob fill.
// generateIslands() still builds the same organic collision polygon with the same area-budget
// rules as before — this only supplies what gets drawn over that polygon (see drawIslands()).
function mkIslandImg(src){ const im = new Image(); im.src = src; return im; }
const ISLAND_SPRITES = [
  {img:mkIslandImg("assets/island-01.png"), aspect:0.9399},
  {img:mkIslandImg("assets/island-02.png"), aspect:1.1186},
  {img:mkIslandImg("assets/island-03.png"), aspect:0.8813},
  {img:mkIslandImg("assets/island-04.png"), aspect:1.1724},
  {img:mkIslandImg("assets/island-05.png"), aspect:0.9797},
  {img:mkIslandImg("assets/island-06.png"), aspect:1.2204},
  {img:mkIslandImg("assets/island-07.png"), aspect:0.9433},
  {img:mkIslandImg("assets/island-08.png"), aspect:1.1928},
  {img:mkIslandImg("assets/island-09.png"), aspect:1.1749},
  {img:mkIslandImg("assets/island-10.png"), aspect:1.1702},
  {img:mkIslandImg("assets/island-11.png"), aspect:1.2671},
  {img:mkIslandImg("assets/island-12.png"), aspect:1.1154},
  {img:mkIslandImg("assets/island-13.png"), aspect:1.1685},
  {img:mkIslandImg("assets/island-14.png"), aspect:1.3043},
  {img:mkIslandImg("assets/island-15.png"), aspect:1.2565},
  {img:mkIslandImg("assets/island-16.png"), aspect:1.1732},
  {img:mkIslandImg("assets/island-17.png"), aspect:0.9637},
  {img:mkIslandImg("assets/island-18.png"), aspect:1.1657},
  {img:mkIslandImg("assets/island-19.png"), aspect:1.0219},
  {img:mkIslandImg("assets/island-20.png"), aspect:1.4172}
];


// Per-ship-type sailing animation for the in-battle stat panel porthole. Ships with no entry
// here simply don't show the porthole (rather than show mismatched art) until their own art exists.
const SPRITE_DESTROYER_SAILING = "assets/destroyer-sailing.png";
const destroyerSailingImg = new Image();
destroyerSailingImg.src = SPRITE_DESTROYER_SAILING;
const SPRITE_FRIGATE_SAILING = "assets/frigate-sailing.png";
const frigateSailingImg = new Image();
frigateSailingImg.src = SPRITE_FRIGATE_SAILING;
const SHIP_SPRITES = {
  Destroyer: { img: destroyerSailingImg, cellW: 252, cellH: 152, frameCount: 6, fps: 8 },
  Frigate: { img: frigateSailingImg, cellW: 262, cellH: 140, frameCount: 4, fps: 8 }
};
let spriteClock = 0; // seconds, advanced each render frame

// Gameplay water-texture background. Drawn on the canvas itself (see render()), stretched
// across the board rect using the same worldToScreen transform as everything else, so it
// zooms and pans in lockstep with the board rather than sitting fixed behind it. The margin
// area outside the board (see #canvasWrap CSS) is a plain dark navy, not this texture, so the
// board reads as a distinct lit-up surface against a darker surround.
const SPRITE_GAMEPLAY_BG = "assets/gameplay-bg.jpg";
const gameplayBgImg = new Image();
gameplayBgImg.src = SPRITE_GAMEPLAY_BG;

/* ============================== CONSTANTS ============================== */
const PX = 2; // pixels per inch
let BOARD_W = 1200, BOARD_H = 800; // inches (4x the original board AREA; ship hull sizes unchanged). Breakthrough uses 800 x 800 (see setBoardSize).
function setBoardSize(w,h){ BOARD_W=w; BOARD_H=h; state.viewCenter={x:BOARD_W/2,y:BOARD_H/2}; }
const DEG2RAD = Math.PI/180;

const SHIP_TYPES = {
  Frigate: {
    movement:30, topSpeedMult:3, shields:10, shieldRegen:5, structure:10, turning:60,
    broadside:1, turret:2, torpedo:2, turnsPerPhase:2, minTurnDist:4,
    turretTraverse:90, gunnery:13, mine:true, mineInv:6,
    armor:{prow:15, starboard:8, port:8, stern:6},
    hullLen:11, hullWide:4
  },
  Destroyer: {
    movement:25, topSpeedMult:3, shields:10, shieldRegen:5, structure:15, turning:45,
    broadside:2, turret:2, torpedo:3, turnsPerPhase:2, minTurnDist:8,
    turretTraverse:60, gunnery:13, mine:false, mineInv:0,
    armor:{prow:15, starboard:12, port:12, stern:6},
    hullLen:16, hullWide:5
  },
  'Light Cruiser': {
    movement:25, topSpeedMult:2.5, shields:10, shieldRegen:5, structure:15, turning:45,
    broadside:3, turret:4, torpedo:1, turnsPerPhase:2, minTurnDist:8,
    turretTraverse:60, gunnery:12, mine:false, mineInv:0,
    armor:{prow:20, starboard:20, port:20, stern:10},
    hullLen:21, hullWide:6
  },
  'Medium Cruiser': {
    movement:25, topSpeedMult:2.5, shields:10, shieldRegen:5, structure:20, turning:45,
    broadside:3, turret:4, torpedo:0, turnsPerPhase:2, minTurnDist:8,
    turretTraverse:60, gunnery:12, mine:false, mineInv:0,
    armor:{prow:25, starboard:22, port:22, stern:15},
    hullLen:21, hullWide:7
  },
  'Heavy Cruiser': {
    movement:25, topSpeedMult:2.5, shields:10, shieldRegen:5, structure:30, turning:45,
    broadside:4, turret:6, torpedo:0, turnsPerPhase:2, minTurnDist:10,
    turretTraverse:60, gunnery:12, mine:false, mineInv:0,
    armor:{prow:30, starboard:25, port:25, stern:15},
    hullLen:22, hullWide:8
  },
  Battleship: {
    movement:20, topSpeedMult:3, shields:10, shieldRegen:5, structure:45, turning:40,
    broadside:6, turret:6, torpedo:0, turnsPerPhase:2, minTurnDist:10,
    turretTraverse:60, gunnery:10, mine:false, mineInv:0,
    armor:{prow:45, starboard:35, port:35, stern:15},
    hullLen:25, hullWide:8
  }
};

const BIG_SHIP_ICONS = {};
const SHIP_ORDER = ['Frigate','Destroyer','Light Cruiser','Medium Cruiser','Heavy Cruiser','Battleship'];
// The larger classes don't have their own art yet: they borrow the Destroyer's sprites (scaled to their hull length).
['Light Cruiser','Medium Cruiser','Heavy Cruiser','Battleship'].forEach(t=>{
  MAP_SHIP_SPRITES[t] = MAP_SHIP_SPRITES.Destroyer;
  SHIP_SPRITES[t] = SHIP_SPRITES.Destroyer;
  SHIP_HERO_IMAGES[t] = SHIP_HERO_IMAGES.Destroyer;
});

// Top-down art for the big ships (single frame each, bow pointing left like the other map sprites).
// The Light Cruiser has none yet and keeps borrowing the Destroyer's.
const SPRITE_BATTLESHIP_ART = "assets/battleship-art.png";
const SPRITE_MEDIUM_CRUISER_ART = "assets/medium-cruiser-art.png";
const SPRITE_MEDIUM_CRUISER_MAP_SAILING = "assets/medium-cruiser-map-sailing.png";
const SPRITE_HEAVY_CRUISER_ART = "assets/heavy-cruiser-art.png";
const BIG_SHIP_SIDE_ART = {
  'Battleship': { sail:"assets/battleship-side-sail.png", hero:"assets/battleship-side-hero.png", icon:"assets/battleship-side-icon.png", cellW:237, cellH:135 },
  'Medium Cruiser': { sail:"assets/medium-cruiser-side-sail.png", hero:"assets/medium-cruiser-side-hero.png", icon:"assets/medium-cruiser-side-icon.png", cellW:269, cellH:130 },
  'Heavy Cruiser': { sail:"assets/heavy-cruiser-side-sail.png", hero:"assets/heavy-cruiser-side-hero.png", icon:"assets/heavy-cruiser-side-icon.png", cellW:223, cellH:132 }
};
[['Battleship', SPRITE_BATTLESHIP_ART, 480, 113], ['Heavy Cruiser', SPRITE_MEDIUM_CRUISER_ART, 480, 130], ['Medium Cruiser', SPRITE_HEAVY_CRUISER_ART, 480, 112]].forEach(([t, src, w, h])=>{
  // On the board these ships use the top-down art above...
  const img = new Image(); img.src = src;
  MAP_SHIP_SPRITES[t] = { img, cellW:w, cellH:h, frameCount:1, fps:1 };
  if(t==='Medium Cruiser'){   // animated 6-frame top-down sailing sheet (hull plus its bow wave, so drawn a little larger)
    const sheet = new Image(); sheet.src = SPRITE_MEDIUM_CRUISER_MAP_SAILING;
    MAP_SHIP_SPRITES[t] = { img:sheet, cellW:245, cellH:104, frameCount:6, fps:8, lenScale:1.15 };
  }
  // ...while the stat-panel porthole, Fitment screen and fleet picker use the side-view sheets.
  const side = BIG_SHIP_SIDE_ART[t];
  const sail = new Image(); sail.src = side.sail;
  SHIP_SPRITES[t] = { img:sail, cellW:side.cellW, cellH:side.cellH, frameCount:6, fps:8 };
  SHIP_HERO_IMAGES[t] = side.hero;
  BIG_SHIP_ICONS[t] = side.icon;
});

// Heavy Cruiser: animated 13-frame top-down sailing sheet on the board (hull plus its bow wave).
// Ship-destroyed explosion: 36 frames of 276x120, played twice (1 s each) over a ship at the end of the Firing phase.
// Sinking clip: a firing-window animation (20 frames of 330x215) shown beside each ship destroyed in the Firing phase.
const SPRITE_SHIP_SINKING = "assets/ship-sinking.jpg";
const sinkingImg = new Image(); sinkingImg.src = SPRITE_SHIP_SINKING;
const SINK_WINDOW_SPEC = { img: sinkingImg, cellW: 330, cellH: 215, frameCount: 20, ms: 3000 };
const SPRITE_SHIP_EXPLOSION = "assets/ship-explosion.png";
const SHIP_EXPLOSION = { img:new Image(), cellW:276, cellH:120, frameCount:36, playMs:1000, plays:2 };
SHIP_EXPLOSION.img.src = SPRITE_SHIP_EXPLOSION;
const SPRITE_BATTLESHIP_MAP_SAILING = "assets/battleship-map-sailing.png";
const SPRITE_HEAVY_CRUISER_MAP_SAILING = "assets/heavy-cruiser-map-sailing.png";
{
  const hcSheet = new Image(); hcSheet.src = SPRITE_HEAVY_CRUISER_MAP_SAILING;
  MAP_SHIP_SPRITES['Heavy Cruiser'] = { img:hcSheet, cellW:232, cellH:96, frameCount:13, fps:10, lenScale:1.2 };
  const bsSheet = new Image(); bsSheet.src = SPRITE_BATTLESHIP_MAP_SAILING;
  MAP_SHIP_SPRITES['Battleship'] = { img:bsSheet, cellW:232, cellH:109, frameCount:13, fps:10, lenScale:1.2 };
}
// Light Cruiser: its own side-view art (porthole sailing animation, Fitment hero, fleet-picker icon).
{
  const lcSail = new Image(); lcSail.src = "assets/light-cruiser-sail.png";
  SHIP_SPRITES['Light Cruiser'] = { img:lcSail, cellW:206, cellH:140, frameCount:6, fps:8 };
  SHIP_HERO_IMAGES['Light Cruiser'] = "assets/light-cruiser-hero.png";
  BIG_SHIP_ICONS['Light Cruiser'] = "assets/light-cruiser-icon.png";
}
// Light Cruiser: animated 6-frame top-down sailing sheet on the board (hull plus its bow wave).
const SPRITE_LIGHT_CRUISER_MAP_SAILING = "assets/light-cruiser-map-sailing.png";
{
  const lcSheet = new Image(); lcSheet.src = SPRITE_LIGHT_CRUISER_MAP_SAILING;
  MAP_SHIP_SPRITES['Light Cruiser'] = { img:lcSheet, cellW:250, cellH:108, frameCount:6, fps:8, lenScale:1.15 };
}

const WEAPONS = {
  Cannon:  {range:140, damage:8,  loc:'turret',    shotsPerTurn:2},
  'Heavy Cannon': {range:200, damage:12, loc:'turret',    shotsPerTurn:1},
  Autogun: {range:80,  damage:5,  loc:'broadside', shotsPerTurn:2},
  Torpedo: {range:600, damage:15, loc:'torpedo',   shotsPerTurn:2} // must reload the turn after it's used
};

const ARCS = ['prow','starboard','stern','port'];

// Display name for a ship: its custom Fitment-phase name if set, else "Type #".
function shipLabel(s){
  return (s.name && s.name.trim()) ? s.name.trim() : `${s.type} ${s.id.replace('S','')}`;
}
// Label with the class added (used in the target drop-downs, since a name alone doesn't say what the ship is).
function shipLabelTyped(s){
  const l = shipLabel(s);
  return l.toLowerCase().startsWith(s.type.toLowerCase()) ? l : `${l} — ${s.type}`;
}
// Names given to the computer's ships, drawn at random without repeats.
const AI_SHIP_NAMES = ['Resolute','Invincible','Vanguard','Bulwark','Intrepid','Defiance','Valiant','Retribution','Thunderer','Dauntless',
  'Relentless','Leviathan','Tempest','Sovereign','Trident','Corsair','Warspite','Indomitable','Audacious','Goliath',
  'Hotspur','Pegasus','Meteor','Orion','Sentinel','Typhoon','Colossus','Avenger','Centurion','Cerberus'];
// Gives every AI ship a unique name from the list. Safe to call again: ships that already have a good name keep it,
// but a name that clashes with one of the player's own ship names (or repeats) is replaced.
function assignAiNames(){
  const taken = new Set(state.fleets.player.map(sh=>shipLabel(sh).toLowerCase()));
  const keep = [];
  state.fleets.ai.forEach(sh=>{
    const n = (sh.name||'').trim().toLowerCase();
    if(n && AI_SHIP_NAMES.some(x=>x.toLowerCase()===n) && !taken.has(n)){ taken.add(n); keep.push(sh); }
    else sh.name = '';
  });
  const pool = AI_SHIP_NAMES.filter(x=>!taken.has(x.toLowerCase()));
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  state.fleets.ai.forEach(sh=>{ if(!sh.name) sh.name = pool.length ? pool.shift() : ''; });   // past 30 ships the default "Type N" label is used
}

/* ============================== STATE ============================== */
let state = {
  fleets: { player:[], ai:[] },
  headingPlayer:null, headingAI:null,
  sunDeg: 0,
  round: 1,
  phase: 'movement', // movement (incl. turret targeting), firing, special (Special Orders)
  activeSide: 'player', // whose sub-step of the phase we're in
  selectedShipId: null,
  selectedShipIds: new Set(), // multi-select group; selectedShipId is the "active" one shown in the panel
  mines: [], // {x,y,side}
  torpedoes: [], // in flight: launched as a Special Attack order, resolved at the end of the next Movement phase
  gameOver:false,
  skirmishType:'annihilation', // 'annihilation' | 'breakthrough' | 'koth'
  bt:null,        // Breakthrough zones / roles (see BREAKTHROUGH MODE)
  btEndNote:null,
  // transient UI state for movement planning
  moveDraft: null, // {speed, turns:[{deg}], laidMineAt:null}
  aimDraft: null,
  fireLog: [],
  // camera
  zoom: 1, // multiplier on top of the fit-to-screen scale
  viewCenter: { x: BOARD_W/2, y: BOARD_H/2 }, // world point shown at canvas center
  boxManualPos: null, // {left,top} if the player has manually dragged the floating ship box
  statBoxOpenedOnce: false, // first time the ship stat box opens this game, it defaults to upper-left
  effects: [], // active hit/miss animations: {type:'explosion'|'splash', x, y, start, duration}
  roundMovePaths: [], // {ship, points} for every ship that moved this round, played back at phase end
  islands: [], // {points:[{x,y}...], cx, cy} generated once per battle
  refloatDrag: null, // active re-float drag session on the map: {ship, curX, curY}
  moveTargetDrag: null, // active click-and-drag-to-set-course session on the map: {ship}
  refloatRotateDrag: null, // active drag-to-rotate session on the re-float heading handle: {ship}
  courseRotateDrag: null, // active drag-to-rotate session on a Special Orders Course Adjustment handle: {ship}
  sweepActive: false, // true while the end-of-Movement sweep (ships moving + turret cones swinging) is playing
  firingCommenced: false // true once "Commence Firing" has resolved this round's queued shots
};
const ZOOM_MIN = 0.5, ZOOM_MAX = 8;

let shipCounter = 0;
function nextId(){ return 'S'+(shipCounter++); }

/* ============================== FLEET SETUP UI ============================== */
const fleetChoice = { player:{Frigate:0, Destroyer:0, 'Light Cruiser':0, 'Medium Cruiser':0, 'Heavy Cruiser':0, Battleship:0}, ai:{Frigate:0, Destroyer:0, 'Light Cruiser':0, 'Medium Cruiser':0, 'Heavy Cruiser':0, Battleship:0} };

function renderFleetPicker(){
  const el = document.getElementById('fleetPicker');
  el.innerHTML = '';
  const SHIP_ICON_IMAGES = { Destroyer: SPRITE_BATTLESHIP_ICON, Frigate: SPRITE_FRIGATE_ICON };
  ['Light Cruiser','Medium Cruiser','Heavy Cruiser','Battleship'].forEach(t=>{ SHIP_ICON_IMAGES[t] = BIG_SHIP_ICONS[t] || SPRITE_BATTLESHIP_ICON; });
  SHIP_ORDER.forEach(type=>{
    const tid = type.replace(/ /g,'_');
    const row = document.createElement('div');
    row.className='shipCardPick';
    const hero = SHIP_HERO_IMAGES[type] || SHIP_ICON_IMAGES[type] || '';
    row.innerHTML = `<div class="heroBox">${hero ? `<img src="${hero}" alt="${type}">` : ''}</div>
      <div class="nm">${type}s</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button data-t="${type}" data-d="-1">−</button>
        <b style="display:inline-block;width:24px;text-align:center;font-size:16px;" id="cnt_${tid}">${fleetChoice.player[type]}</b>
        <button data-t="${type}" data-d="1">+</button>
      </div>`;
    el.appendChild(row);
  });
  el.querySelectorAll('button').forEach(b=>{
    b.onclick = ()=>{
      const t=b.dataset.t, d=parseInt(b.dataset.d);
      fleetChoice.player[t] = Math.max(0, Math.min(5, fleetChoice.player[t]+d));
      document.getElementById('cnt_'+t.replace(/ /g,'_')).textContent = fleetChoice.player[t];
      btSyncSetupBox();
    };
  });
}
renderFleetPicker();

document.getElementById('toFitmentBtn').onclick = ()=>{
  const total = SHIP_ORDER.reduce((n,t)=>n+fleetChoice.player[t],0);
  if(total<1){ alert('Pick at least one ship.'); return; }
  SHIP_ORDER.forEach(t=>{ fleetChoice.ai[t] = fleetChoice.player[t]; });
  // Coming back from Fitment with the same fleet keeps the ships (and their loadouts and names) as they were.
  const sameFleet = state.fleets.player.length>0 && SHIP_ORDER.every(t=> state.fleets.player.filter(sh=>sh.type===t).length === fleetChoice.player[t]);
  if(!sameFleet){
    state.fleets.player = createFleetShips(fleetChoice.player, 'player');
    state.fleets.ai = createFleetShips(fleetChoice.ai, 'ai');
  }
  assignAiNames();
  document.getElementById('titleScreen').style.display='none';
  document.getElementById('fitmentScreen').style.display='flex';
  fitSelectedShipId = state.fleets.player[0] ? state.fleets.player[0].id : null;
  fitSelection = null;
  renderFitmentScreen();
};

document.getElementById('toFormationBtn').onclick = ()=>{
  const unfitted = state.fleets.player.map(s=>({s, n:emptySlotCount(s)})).filter(x=>x.n>0);
  if(unfitted.length===0){ proceedToFormation(); return; }
  document.getElementById('emptySlotsList').innerHTML =
    unfitted.map(x=>`<li>${shipLabel(x.s)} — ${x.n} empty mount${x.n===1?'':'s'}</li>`).join('');
  document.getElementById('emptySlotsModal').classList.add('show');
};
function proceedToFormation(){
  if(state.skirmishType==='breakthrough' || state.skirmishType==='koth'){ proceedToBtBriefing(); return; }
  document.getElementById('fitmentScreen').style.display='none';
  document.getElementById('formationScreen').style.display='flex';
  initFormationScreen();
}

/* ============================== FORMATION SCREEN (100"x100" drag-and-drop zone) ============================== */
function initFormationScreen(){
  const grid = document.getElementById('formationGrid');
  // Decorative rings + centre crosshair — built once, left alone on re-renders.
  if(!grid.querySelector('.formationCross')){
    [0.25,0.5,0.75,1].forEach(f=>{
      const ring = document.createElement('div');
      ring.className = 'formationRing';
      ring.style.width = (f*100)+'%';
      ring.style.height = (f*100)+'%';
      grid.appendChild(ring);
    });
    const cross = document.createElement('div');
    cross.className = 'formationCross';
    grid.appendChild(cross);
  }
  // Default formation: a line abreast, centred, unless the player already arranged one this session.
  const n = state.fleets.player.length;
  state.fleets.player.forEach((s,i)=>{
    if(!s.formationOffset){
      s.formationOffset = {right:(i-(n-1)/2)*22, forward:0};
    }
  });
  renderFormationScreen();
}

// Same hull silhouette used on the battle map (see drawShip), rendered as a standalone icon.
// Ship 0°/forward already points "up" in this shape, which matches "forward = up" in the
// formation zone directly — no rotation needed here.
function shipHullIconSVG(s, boxPx){
  const color = shipColor(s);
  const scale = boxPx / Math.max(s.hullLen, s.hullWide*1.6);
  const len = s.hullLen*scale, wid = s.hullWide*scale;
  const cx = boxPx/2, cy = boxPx/2;
  const pts = [
    [cx, cy-len/2],
    [cx+wid/2, cy+len/2*0.6],
    [cx+wid/4, cy+len/2],
    [cx-wid/4, cy+len/2],
    [cx-wid/2, cy+len/2*0.6]
  ].map(p=>p.join(',')).join(' ');
  return `<svg viewBox="0 0 ${boxPx} ${boxPx}" width="${boxPx}" height="${boxPx}">
    <polygon points="${pts}" fill="${color}" stroke="#eafcff" stroke-width="1.5"/>
  </svg>`;
}

function renderFormationScreen(){
  const grid = document.getElementById('formationGrid');
  grid.querySelectorAll('.formationToken').forEach(el=>el.remove());
  const rect = grid.getBoundingClientRect();
  const scale = Math.min(rect.width, rect.height)/100; // px per inch — zone is a 100"x100" square
  state.fleets.player.forEach(s=>{
    const tok = document.createElement('div');
    tok.className = 'formationToken';
    tok.style.left = (rect.width/2 + s.formationOffset.right*scale) + 'px';
    tok.style.top = (rect.height/2 - s.formationOffset.forward*scale) + 'px';
    tok.title = `${shipLabel(s)} (${s.type})`;
    tok.innerHTML = `${shipHullIconSVG(s, 34)}<span class="ftoklabel">${shipLabel(s).slice(0,14)}</span>`;
    tok.dataset.shipId = s.id;
    grid.appendChild(tok);
    wireFormationTokenDrag(tok, s, grid);
  });
}

function wireFormationTokenDrag(tok, s, grid){
  tok.addEventListener('mousedown', (e)=>{
    e.preventDefault();
    tok.classList.add('dragging');
    const move = (ev)=>{
      const rect = grid.getBoundingClientRect();
      const scale = Math.min(rect.width, rect.height)/100;
      let px = Math.max(0, Math.min(rect.width, ev.clientX-rect.left));
      let py = Math.max(0, Math.min(rect.height, ev.clientY-rect.top));
      s.formationOffset = {
        right: Math.max(-50, Math.min(50, (px-rect.width/2)/scale)),
        forward: Math.max(-50, Math.min(50, (rect.height/2-py)/scale))
      };
      tok.style.left = px+'px';
      tok.style.top = py+'px';
    };
    const up = ()=>{
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      tok.classList.remove('dragging');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

document.getElementById('emptySlotsBackBtn').onclick = ()=>{
  document.getElementById('emptySlotsModal').classList.remove('show');
};
document.getElementById('emptySlotsContinueBtn').onclick = ()=>{
  document.getElementById('emptySlotsModal').classList.remove('show');
  proceedToFormation();
};

document.getElementById('toHeadingBtn').onclick = ()=>{
  document.getElementById('formationScreen').style.display='none';
  document.getElementById('headingModal').classList.add('show');
};
document.getElementById('resetFormationBtn').onclick = ()=>{
  state.fleets.player.forEach((s,i)=>{
    s.formationOffset = {right:(i-(state.fleets.player.length-1)/2)*22, forward:0};
  });
  renderFormationScreen();
};

document.getElementById('backToFleetBtn').onclick = ()=>{
  document.getElementById('fitmentScreen').style.display='none';
  document.getElementById('titleScreen').style.display='flex';
};
document.getElementById('backToFitmentBtn').onclick = ()=>{
  document.getElementById('formationScreen').style.display='none';
  document.getElementById('fitmentScreen').style.display='flex';
  renderFitmentScreen();
};
document.getElementById('backToFormationBtn').onclick = ()=>{
  document.getElementById('headingModal').classList.remove('show');
  document.getElementById('formationScreen').style.display='flex';
};
document.getElementById('resetFitBtn').onclick = ()=>{
  if(!confirm('Reset every ship to its standard default weapon loadout?')) return;
  state.fleets.player.forEach(s=>resetShipLoadout(s, false));
  fitSelection = null;
  renderFitmentScreen();
};

document.querySelectorAll('#headingModal button[data-h]').forEach(b=>{
  b.onclick = ()=>{
    state.headingPlayer = b.dataset.h;
    const opts=['North','South','East','West'];
    state.headingAI = opts[Math.floor(Math.random()*4)];
    document.getElementById('headingModal').classList.remove('show');
    battleMusic.currentTime = 0;
    // Called directly from this click, so most browsers allow it — but if THIS browser's
    // autoplay policy still blocks it for some reason, the toggle button (now visible once the
    // battle starts) lets the player start it with one more direct click of their own.
    battleMusic.play().catch(()=>{});
    startGame();
  };
});

document.getElementById('helpBtn').onclick = ()=> document.getElementById('helpModal').classList.add('show');
document.getElementById('closeHelp').onclick = ()=> document.getElementById('helpModal').classList.remove('show');
document.getElementById('surrenderBtn').onclick = ()=>{
  if(confirm('Surrender the battle?')){ endGame('ai', 'surrender'); }
};

/* ============================== GAME START ============================== */
function makeShip(type, side, id){
  const base = SHIP_TYPES[type];
  const armor = Object.assign({}, base.armor);
  const ship = {
    id, side, type,
    name:'', // custom name, set in the Fitment phase
    x:0, y:0, heading:0,
    movement:base.movement, shieldsMax:base.shields, shieldRegen:base.shieldRegen,
    baseMovement:base.movement, topSpeedMult:base.topSpeedMult, lastDistance:null, // momentum tracking (rule 4c)
    distanceMoved:0, // lifetime distance travelled, for the end-of-battle summary
    weaponStats:{ Cannon:{fired:0,hits:0,damage:0}, 'Heavy Cannon':{fired:0,hits:0,damage:0},
      Autogun:{fired:0,hits:0,damage:0}, Torpedo:{fired:0,hits:0,damage:0}, Mine:{fired:0,hits:0,damage:0} },
    structureMax:base.structure, structureCur:base.structure,
    turning:base.turning, turnsPerPhase:base.turnsPerPhase, minTurnDist:base.minTurnDist,
    turretTraverse:base.turretTraverse, gunnery:base.gunnery,
    hasMine:base.mine, mineInv: base.mine ? base.mineInv : 0,
    hullLen:base.hullLen, hullWide:base.hullWide,
    shields:{prow:base.shields, starboard:base.shields, stern:0, port:base.shields},
    armor,
    destroyed:false,
    movementPlan:null,
    moveAnim:null, // {points, startTime, duration} while its plotted move is animating on screen
    moveDragPreview:null, // {x,y,heading} while the player is actively dragging it to set course
    firedThisRound:{broadside:false, turret:false, torpedo:false},
    aimTargetId:null,      // the enemy this ship's turrets are (or are about to be) aimed at
    crit:null,             // Critical Damage condition: {kind:'steering'|'dead', dir:-1|+1 (steering: which way the wheel is stuck), fresh, repairRolls} or null
    targetConfirmed:false, // player ships: that target is locked in (drawn as a red line; the turret swings to it during the sweep)
    turretSyncHeading:null, // the hull heading that turretFacing was last settled against (so an untargeted turret can turn WITH the hull)
    turretAnim:null        // {from, delta, startTime, duration} while the turret cone swings during the movement sweep (visual only)
  };
  // Player ships start with empty mounts for the Fitment phase; the AI fleet gets a standard loadout.
  resetShipLoadout(ship, false); // every mount starts filled with the standard loadout (Autogun / Cannon / Torpedo); the player can change it in Fitment
  return ship;
}

// Fitment: (re)apply a weapon loadout to every slot. empty=true clears every mount (Fitment start state);
// empty=false (or omitted) fills every mount with the ship type's standard default weapon.
function makeWeaponSlot(wname){
  return wname ? {weapon:wname, shotsLeft:WEAPONS[wname].shotsPerTurn} : null;
}
function resetShipLoadout(ship, empty){
  const base = SHIP_TYPES[ship.type];
  const bFill = empty ? null : 'Autogun';
  const tFill = empty ? null : 'Cannon';
  const torpFill = empty ? null : 'Torpedo';
  ship.broadsidePort = Array(base.broadside).fill(0).map(()=>makeWeaponSlot(bFill));
  ship.broadsideStarboard = Array(base.broadside).fill(0).map(()=>makeWeaponSlot(bFill));
  ship.turretWeapons = Array(base.turret).fill(0).map(()=>makeWeaponSlot(tFill));
  ship.turretFacing = ship.turretFacing!=null ? ship.turretFacing : 0;
  ship.torpedoTubes = Array(base.torpedo).fill(0).map(()=>({
    weapon: torpFill,
    shotsLeft: torpFill ? WEAPONS[torpFill].shotsPerTurn : 0,
    shotsReloading: 0 // shots fired last round, unavailable this round, returning to shotsLeft next reset
  }));
}

// Called at the start of each side's turn: refills shot counts, and cycles torpedo tubes through
// their reload state ONE SHOT AT A TIME. Each individual shot gets its own one-round cooldown from
// the moment it's fired — firing only 1 of a tube's 2 shots leaves the other one still available
// next round, while just the fired shot reloads (rather than the whole tube going dark).
function resetWeaponShots(ship){
  [ship.broadsidePort, ship.broadsideStarboard, ship.turretWeapons].forEach(arr=>{
    arr.forEach(entry=>{ if(entry) entry.shotsLeft = WEAPONS[entry.weapon].shotsPerTurn; });
  });
  ship.torpedoTubes.forEach(t=>{
    if(!t.weapon) return;
    const max = WEAPONS[t.weapon].shotsPerTurn;
    t.shotsReloading = t.shotsReloading || 0;
    // Shots consumed since the last reset that haven't yet entered the reload queue:
    const justFired = Math.max(0, max - t.shotsLeft - t.shotsReloading);
    t.shotsLeft += t.shotsReloading;   // shots that finished their one-round cooldown are ready again
    t.shotsReloading = justFired;      // shots just fired now start their own cooldown
  });
}

function emptySlotCount(s){
  return s.broadsidePort.filter(w=>!w).length + s.broadsideStarboard.filter(w=>!w).length +
    s.turretWeapons.filter(w=>!w).length + s.torpedoTubes.filter(t=>!t.weapon).length;
}

function createFleetShips(counts, side){
  const ships = [];
  SHIP_ORDER.forEach(type=>{
    for(let i=0;i<(counts[type]||0);i++){ ships.push(makeShip(type, side, nextId())); }
  });
  return ships;
}

function headingToDeg(h){ return {North:0, East:90, South:180, West:270}[h]; }
function opposite(h){ return {North:'South',South:'North',East:'West',West:'East'}[h]; }

/* ============================== ISLANDS (obstacles) ============================== */
function polygonArea(pts){
  let a=0;
  for(let i=0;i<pts.length;i++){
    const p1=pts[i], p2=pts[(i+1)%pts.length];
    a += p1.x*p2.y - p2.x*p1.y;
  }
  return Math.abs(a)/2;
}
function pointInPolygon(x,y,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function islandAt(x,y){
  for(const isl of state.islands){
    if(pointInPolygon(x,y,isl.points)) return isl;
  }
  return null;
}
// Parametric segment intersection: returns {x,y,t} where t is the fraction along segment 1
// (x1,y1)-(x2,y2) at which it crosses segment 2 (x3,y3)-(x4,y4), or null if they don't cross.
function segIntersect(x1,y1,x2,y2,x3,y3,x4,y4){
  const d = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
  if(Math.abs(d)<1e-9) return null;
  const t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / d;
  const u = ((x1-x3)*(y1-y2) - (y1-y3)*(x1-x2)) / d;
  if(t<0||t>1||u<0||u>1) return null;
  return { x: x1+t*(x2-x1), y: y1+t*(y2-y1), t };
}
// Exact polygon-vs-polygon overlap test (edge crossings, plus containment in case one polygon
// sits entirely inside the other) — used to keep generated islands from overlapping each other.
// Edges that merely meet or graze without crossing don't count, so islands can still touch.
function polygonsOverlap(polyA, polyB){
  for(let i=0;i<polyA.length;i++){
    const a1=polyA[i], a2=polyA[(i+1)%polyA.length];
    for(let j=0;j<polyB.length;j++){
      const b1=polyB[j], b2=polyB[(j+1)%polyB.length];
      if(segIntersect(a1.x,a1.y,a2.x,a2.y,b1.x,b1.y,b2.x,b2.y)) return true;
    }
  }
  if(pointInPolygon(polyA[0].x, polyA[0].y, polyB)) return true;
  if(pointInPolygon(polyB[0].x, polyB[0].y, polyA)) return true;
  return false;
}
// Line of sight: does any island stand directly between these two points? Used to block fire.
function lineBlockedByIsland(x1,y1,x2,y2){
  for(const isl of state.islands){
    const poly = isl.points;
    for(let i=0;i<poly.length;i++){
      const a=poly[i], b=poly[(i+1)%poly.length];
      if(segIntersect(x1,y1,x2,y2,a.x,a.y,b.x,b.y)) return isl;
    }
  }
  return null;
}
// Casts a ray from (shipX,shipY) at a compass angle out to maxDist and returns the distance to
// the nearest island edge it crosses, or null if the ray reaches maxDist clear. Used only to
// draw the "shadow" an island casts across a firing arc — the real block check is the one above.
function rayIslandHitDistance(shipX, shipY, angleDeg, maxDist){
  const rad = angleDeg*DEG2RAD;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const ex = shipX+dx*maxDist, ey = shipY+dy*maxDist;
  let nearestT = null;
  for(const isl of state.islands){
    const poly = isl.points;
    for(let i=0;i<poly.length;i++){
      const a=poly[i], b=poly[(i+1)%poly.length];
      const hit = segIntersect(shipX,shipY,ex,ey,a.x,a.y,b.x,b.y);
      if(hit && (nearestT==null || hit.t<nearestT)) nearestT = hit.t;
    }
  }
  return nearestT==null ? null : nearestT*maxDist;
}
// A rough, generic organic outline: random radius per vertex around a center, smoothed a
// couple of passes so it reads as a coastline rather than a jagged starburst.
function generateBlobPolygon(cx, cy, baseR, aspect=1){
  const numPts = 10 + Math.floor(Math.random()*6); // 10-15 vertices
  const angles = Array.from({length:numPts}, (_,i)=> (i/numPts)*Math.PI*2);
  let radii = angles.map(()=> baseR*(0.55+Math.random()*0.7));
  for(let pass=0; pass<2; pass++){
    radii = radii.map((r,i)=> (radii[(i-1+numPts)%numPts] + r*2 + radii[(i+1)%numPts]) / 4);
  }
  // Anisotropic stretch toward the chosen sprite's own aspect ratio, sx*sy=1 so the polygon's
  // area comes out exactly the same as the unstretched (aspect=1) version — every area-budget
  // computation downstream is unaffected by this, only the shape's proportions change.
  const sx = Math.sqrt(aspect), sy = 1/Math.sqrt(aspect);
  return angles.map((a,i)=> ({x: cx+Math.cos(a)*radii[i]*sx, y: cy+Math.sin(a)*radii[i]*sy}));
}
function generateIslands(opts){
  const capArea = 0.05 * BOARD_W * BOARD_H; // islands never cover more than 5% of the board
  const n = 1 + Math.floor(Math.random()*5); // 1 to 5 islands
  const islands = [];
  let usedArea = 0;
  const allShipsNow = (opts && opts.ignoreShips) ? [] : [...state.fleets.player, ...state.fleets.ai];
  // Sample sprite assignments without replacement so a single battle doesn't repeat art
  // (5 islands max, 20 sprites available, so this always has enough to draw from).
  const spriteOrder = ISLAND_SPRITES.map((_,i)=>i);
  for(let i=spriteOrder.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [spriteOrder[i],spriteOrder[j]]=[spriteOrder[j],spriteOrder[i]]; }
  for(let i=0; i<n; i++){
    const remaining = capArea - usedArea;
    if(remaining < 150) break;
    const targetArea = Math.min(remaining*0.85, (capArea/n) * (0.5+Math.random()*0.9));
    const baseR = Math.sqrt(targetArea/Math.PI);
    const margin = baseR*1.6 + 25;
    if(margin*2 >= BOARD_W || margin*2 >= BOARD_H) continue;
    const spriteIdx = spriteOrder[i % spriteOrder.length];
    const aspect = ISLAND_SPRITES[spriteIdx].aspect;
    let placed = false;
    for(let attempt=0; attempt<10 && !placed; attempt++){
      const cx = margin + Math.random()*(BOARD_W-2*margin);
      const cy = margin + Math.random()*(BOARD_H-2*margin);
      // keep clear of every ship's starting spot so nobody starts the battle aground
      const tooClose = allShipsNow.some(s=> dist(s.x,s.y,cx,cy) < baseR + 60);
      if(tooClose) continue;
      const points = generateBlobPolygon(cx, cy, baseR, aspect);
      let area = polygonArea(points);
      let finalPoints = points;
      if(usedArea + area > capArea){
        const scale = Math.sqrt(Math.max(0,capArea-usedArea)/area);
        if(scale < 0.3) continue;
        finalPoints = points.map(p=>({x:cx+(p.x-cx)*scale, y:cy+(p.y-cy)*scale}));
        area = polygonArea(finalPoints);
      }
      if(opts && opts.avoidRects){ // Breakthrough: keep clear of the deployment zones and the Exit Zone
        const xs=finalPoints.map(q=>q.x), ys=finalPoints.map(q=>q.y);
        const bx0=Math.min(...xs), bx1=Math.max(...xs), by0=Math.min(...ys), by1=Math.max(...ys);
        if(opts.avoidRects.some(r=> bx0 < r.x+r.w+14 && bx1 > r.x-14 && by0 < r.y+r.h+14 && by1 > r.y-14)) continue;
      }
      if(islands.some(other=>polygonsOverlap(finalPoints, other.points))) continue; // touching is fine, overlapping isn't
      islands.push({points:finalPoints, cx, cy, spriteIdx});
      usedArea += area;
      placed = true;
    }
  }
  return islands;
}

function placeFleets(){
  const pDeg = headingToDeg(state.headingPlayer);
  const margin = 40;
  function edgePos(deg, frac){
    // frac 0 = a fleet's own starting edge, 1 = far edge, measured along its direction of travel
    if(deg===0) return {x:BOARD_W/2, y:BOARD_H-margin-frac*(BOARD_H-2*margin)}; // North: starts south, travels up
    if(deg===180) return {x:BOARD_W/2, y:margin+frac*(BOARD_H-2*margin)}; // South: starts north, travels down
    if(deg===90) return {x:margin+frac*(BOARD_W-2*margin), y:BOARD_H/2}; // East: starts west, travels east
    if(deg===270) return {x:BOARD_W-margin-frac*(BOARD_W-2*margin), y:BOARD_H/2}; // West: starts east, travels west
  }
  const contested = state.headingPlayer === state.headingAI;
  let playerHeading, aiHeading, playerFrac, aiFrac;
  if(contested){
    // Both fleets are travelling the SAME direction: a stern chase, not a head-on approach.
    const loserSide = Math.random()<0.5 ? 'player' : 'ai';
    logMsg('sys', `Both fleets approached on the same heading — a contested crossing! ${loserSide==='player'?'You are':'The enemy is'} caught out ahead, with the pursuer bearing down from behind.`);
    playerHeading = pDeg; aiHeading = pDeg;
    playerFrac = loserSide==='player' ? 0.667 : 0.02;
    aiFrac = loserSide==='ai' ? 0.667 : 0.02;
  } else {
    // Face-to-face approach along the same axis, opposite directions.
    playerHeading = pDeg;
    aiHeading = (pDeg+180)%360;
    playerFrac = 0.06;
    aiFrac = 0.06;
  }
  const perp = (pDeg+90)*DEG2RAD;
  const px = Math.sin(perp), py = -Math.cos(perp);
  const fx = Math.sin(pDeg*DEG2RAD), fy = -Math.cos(pDeg*DEG2RAD); // "forward" vector for the formation
  const spacing = 28;

  state.fleets.player.forEach((s,i)=>{
    let pos = edgePos(playerHeading, playerFrac);
    if(s.formationOffset){
      // Formation phase: place relative to the fleet's anchor point using the player's own
      // custom right/forward offsets (set in the 100"x100" Formation screen).
      s.x = pos.x + px*s.formationOffset.right + fx*s.formationOffset.forward;
      s.y = pos.y + py*s.formationOffset.right + fy*s.formationOffset.forward;
    } else {
      const off = (i-(state.fleets.player.length-1)/2)*spacing;
      s.x = pos.x + px*off; s.y = pos.y + py*off;
    }
    s.heading = playerHeading;
  });
  state.fleets.ai.forEach((s,i)=>{
    const off = (i-(state.fleets.ai.length-1)/2)*spacing;
    let pos = edgePos(aiHeading, aiFrac);
    s.x = pos.x + px*off; s.y = pos.y + py*off;
    s.heading = aiHeading;
  });
  // Turrets start trained dead ahead, whatever the starting heading (they used to default to north).
  [...state.fleets.player, ...state.fleets.ai].forEach(s=>{ s.turretFacing = s.heading; s.turretSyncHeading = s.heading; });
}

// Main menu: Skirmish is the current game (one battle against the AI); the other modes are placeholders for now.
function showMainMenu(){
  document.getElementById('mainMenuScreen').style.display='flex';
  document.getElementById('skirmishTypeScreen').style.display='none';
  document.getElementById('btBriefModal').classList.remove('show');
  document.getElementById('titleScreen').style.display='none';
  document.getElementById('fitmentScreen').style.display='none';
  document.getElementById('formationScreen').style.display='none';
}
function startMode(mode){
  state.gameMode = mode;   // 'skirmish' for now; Campaign / Missions / Multiplayer will plug in here
  document.getElementById('mainMenuScreen').style.display='none';
  document.getElementById('titleScreen').style.display='flex';
}
document.getElementById('modeSkirmishBtn').onclick = ()=>{
  document.getElementById('mainMenuScreen').style.display='none';
  document.getElementById('skirmishTypeScreen').style.display='flex';
};
document.getElementById('skirmishBackBtn').onclick = showMainMenu;
document.getElementById('modeAnnihilationBtn').onclick = ()=>{
  state.skirmishType = 'annihilation';
  setBoardSize(1200,800);
  document.getElementById('skirmishTypeScreen').style.display='none';
  btSyncSetupBox();
  startMode('skirmish');
};
document.getElementById('modeKothBtn').onclick = ()=>{
  state.skirmishType = 'koth';
  setBoardSize(800,800);
  document.getElementById('skirmishTypeScreen').style.display='none';
  btSyncSetupBox();
  startMode('skirmish');
};
document.getElementById('modeBreakthroughBtn').onclick = ()=>{
  state.skirmishType = 'breakthrough';
  setBoardSize(800,800);
  document.getElementById('skirmishTypeScreen').style.display='none';
  btSyncSetupBox();
  startMode('skirmish');
};
function btSyncSetupBox(){
  const on = state.skirmishType==='breakthrough';
  const box = document.getElementById('btSetupBox');
  box.style.display = on ? 'block' : 'none';
  if(!on) return;
  const total = SHIP_ORDER.reduce((n,t)=>n+fleetChoice.player[t],0);
  btOpt.vipCount = Math.max(1, Math.min(btOpt.vipCount, Math.max(1,total)));
  document.getElementById('btRoleAtk').classList.toggle('primary', btOpt.role==='attacker');
  document.getElementById('btRoleDef').classList.toggle('primary', btOpt.role==='defender');
  document.getElementById('btVipCount').textContent = btOpt.vipCount;
}
document.getElementById('btRoleAtk').onclick = ()=>{ btOpt.role='attacker'; btSyncSetupBox(); };
document.getElementById('btRoleDef').onclick = ()=>{ btOpt.role='defender'; btSyncSetupBox(); };
document.getElementById('btVipMinus').onclick = ()=>{ btOpt.vipCount = Math.max(1, btOpt.vipCount-1); btSyncSetupBox(); };
document.getElementById('btVipPlus').onclick = ()=>{
  const total = SHIP_ORDER.reduce((n,t)=>n+fleetChoice.player[t],0);
  btOpt.vipCount = Math.min(Math.max(1,total), btOpt.vipCount+1); btSyncSetupBox();
};
document.getElementById('backToMenuBtn').onclick = showMainMenu;

function startGame(){
  document.getElementById('mainMenuScreen').style.display='none';
  document.getElementById('titleScreen').style.display='none';
  document.getElementById('app').style.display='flex';
  state.sunDeg = Math.floor(Math.random()*360);
  document.getElementById('sunBearing').textContent = state.sunDeg;
  assignAiNames();   // the player may have named a ship after one of the AI's
  placeFleets();
  allShips().forEach(s=>{ s.turretSyncHeading = s.heading; });
  state.islands = generateIslands();
  resizeCanvas();
  logMsg('sys','The fleets sight one another. Battle is joined.');
  beginRound();
  startAnimLoop();
}

/* ============================== FITMENT SCREEN (drag & drop loadouts) ============================== */
let fitSelectedShipId = null;
let fitSelection = null; // {type:'slot', shipId, catKey, idx} | {type:'weapon', weapon} | null

const WEAPON_ICON_COLOR = { Cannon:'#9fb3c8', 'Heavy Cannon':'#3fd0ff', Autogun:'#e8c15a', Torpedo:'#ff6b4a' };
// Which weapons are legal in each slot category, keyed by the ship-field name that holds that category's array.
const SLOT_CATEGORIES = [
  { key:'broadsidePort',      label:'Port Broadside',      options:['Autogun'] },
  { key:'broadsideStarboard', label:'Starboard Broadside', options:['Autogun'] },
  { key:'turretWeapons',      label:'Turrets',              options:['Cannon','Heavy Cannon'] },
  { key:'torpedoTubes',       label:'Torpedo Tubes',        options:['Torpedo'] }
];

// Some weapons only fit certain hulls.
const WEAPON_SHIP_LIMIT = { 'Heavy Cannon': ['Battleship'] };
function slotAccepts(cat, wname, ship){
  if(!cat.options.includes(wname)) return false;
  const lim = WEAPON_SHIP_LIMIT[wname];
  return !lim || (ship && lim.includes(ship.type));
}
function weaponIconSVG(name){
  if(!name){
    return `<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="8" fill="none" stroke="#3c5062" stroke-width="1.5" stroke-dasharray="3,3"/><line x1="8" y1="12" x2="16" y2="12" stroke="#3c5062" stroke-width="1.5"/><line x1="12" y1="8" x2="12" y2="16" stroke="#3c5062" stroke-width="1.5"/></svg>`;
  }
  const c = WEAPON_ICON_COLOR[name] || '#888';
  if(name==='Cannon'){
    return `<svg viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="9" width="13" height="6" rx="1.5" fill="${c}"/><circle cx="18" cy="12" r="3.2" fill="${c}"/><rect x="1" y="10.5" width="3" height="3" fill="#20303c"/></svg>`;
  }
  if(name==='Heavy Cannon'){
    return `<svg viewBox="0 0 24 24" width="26" height="26"><polygon points="12,2 16.5,12 12,22 7.5,12" fill="${c}"/><line x1="12" y1="3" x2="12" y2="21" stroke="#fff" stroke-width="1" opacity="0.55"/></svg>`;
  }
  if(name==='Autogun'){
    return `<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="6.5" fill="none" stroke="${c}" stroke-width="3"/><circle cx="12" cy="12" r="2.3" fill="${c}"/>
      <line x1="12" y1="1.5" x2="12" y2="4.5" stroke="${c}" stroke-width="3"/><line x1="12" y1="19.5" x2="12" y2="22.5" stroke="${c}" stroke-width="3"/>
      <line x1="1.5" y1="12" x2="4.5" y2="12" stroke="${c}" stroke-width="3"/><line x1="19.5" y1="12" x2="22.5" y2="12" stroke="${c}" stroke-width="3"/></svg>`;
  }
  if(name==='Torpedo'){
    return `<svg viewBox="0 0 24 24" width="26" height="26"><ellipse cx="9" cy="12" rx="7.5" ry="3.4" fill="${c}"/><polygon points="16.5,12 22,7.5 22,16.5" fill="${c}"/><polygon points="2,9 2,15 5,12" fill="#20303c"/></svg>`;
  }
  return '';
}

function renderFitShipTabs(){
  const el = document.getElementById('fitShipTabs');
  el.innerHTML='';
  state.fleets.player.forEach(s=>{
    const b = document.createElement('button');
    b.textContent = `${s.type[0]} ${s.id.replace('S','')} — ${shipLabel(s)}`;
    b.className = s.id===fitSelectedShipId ? 'active' : '';
    b.onclick = ()=>{ fitSelectedShipId = s.id; fitSelection=null; renderFitmentScreen(); };
    el.appendChild(b);
  });
}

function fitAssign(ship, catKey, idx, wname){
  if(catKey==='torpedoTubes'){
    ship.torpedoTubes[idx].weapon = wname;
    ship.torpedoTubes[idx].shotsLeft = WEAPONS[wname].shotsPerTurn;
    ship.torpedoTubes[idx].shotsReloading = 0;
  } else {
    ship[catKey][idx] = makeWeaponSlot(wname);
  }
}

function fitSlotClick(ship, cat, idx){
  const arr = ship[cat.key];
  // A weapon is already selected: if it's legal here, fit it and clear selection.
  if(fitSelection && fitSelection.type==='weapon'){
    if(slotAccepts(cat, fitSelection.weapon, ship)){
      fitAssign(ship, cat.key, idx, fitSelection.weapon);
      fitSelection = null;
      renderFitmentScreen();
      return;
    }
    fitSelection = null; // incompatible target — drop the old selection, fall through to reselect this slot
  }
  // Toggle off if re-clicking the same selected slot.
  if(fitSelection && fitSelection.type==='slot' && fitSelection.shipId===ship.id && fitSelection.catKey===cat.key && fitSelection.idx===idx){
    fitSelection = null;
  } else {
    fitSelection = {type:'slot', shipId:ship.id, catKey:cat.key, idx};
  }
  renderFitmentScreen();
}

function fitWeaponClick(ship, wname){
  // A slot is already selected: if this weapon is legal there, fit it and clear selection.
  if(fitSelection && fitSelection.type==='slot' && fitSelection.shipId===ship.id){
    const cat = SLOT_CATEGORIES.find(c=>c.key===fitSelection.catKey);
    if(slotAccepts(cat, wname, ship)){
      fitAssign(ship, cat.key, fitSelection.idx, wname);
      fitSelection = null;
      renderFitmentScreen();
      return;
    }
    fitSelection = null;
  }
  if(fitSelection && fitSelection.type==='weapon' && fitSelection.weapon===wname){
    fitSelection = null;
  } else {
    fitSelection = {type:'weapon', weapon:wname};
  }
  renderFitmentScreen();
}

function renderFitmentScreen(){
  renderFitShipTabs();
  const main = document.getElementById('fitMain');
  const s = state.fleets.player.find(sh=>sh.id===fitSelectedShipId);
  if(!s){ main.innerHTML = '<div class="smallDim">No ships to fit.</div>'; return; }
  const heroImg = document.getElementById('fitHeroImg');
  if(heroImg && SHIP_HERO_IMAGES[s.type]){ heroImg.src = SHIP_HERO_IMAGES[s.type]; heroImg.alt = s.type; }
  let html = `<div class="row" style="align-items:center;gap:8px;margin-bottom:2px;">
      <span class="smallDim">${s.type} ${s.id.replace('S','')} — Name:</span>
      <input type="text" id="shipNameInput" value="${(s.name||'').replace(/"/g,'&quot;')}" placeholder="e.g. HMS Resolute" maxlength="24" style="flex:1;">
    </div>
    <div class="fitHint">Gunnery ${s.gunnery} &middot; Turret traverse ${s.turretTraverse}&deg;/phase &middot; click an empty slot, then a weapon (or vice-versa) — or drag one onto the other.</div>`;
  SLOT_CATEGORIES.forEach(cat=>{
    const arr = s[cat.key];
    html += `<div class="fitRow"><h4>${cat.label}</h4><div class="slotStrip">`;
    arr.forEach((entry,idx)=>{
      const wname = cat.key==='torpedoTubes' ? entry.weapon : (entry ? entry.weapon : null);
      const isSelected = fitSelection && fitSelection.type==='slot' && fitSelection.shipId===s.id && fitSelection.catKey===cat.key && fitSelection.idx===idx;
      // "open slots which it can be fitted in": only empty slots light up for a selected weapon.
      const isEligible = fitSelection && fitSelection.type==='weapon' && !wname && slotAccepts(cat, fitSelection.weapon, s);
      const cls = ['fitSlot', wname?'filled':'empty', isSelected?'selected':'', isEligible?'eligible':''].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-ship="${s.id}" data-cat="${cat.key}" data-idx="${idx}">
        ${weaponIconSVG(wname)}<span class="wname">${wname||'Empty'}</span></div>`;
    });
    html += `</div></div>`;
  });
  html += `<div class="fitRow"><h4>Available Weapons</h4><div class="palette" id="fitPalette"></div></div>`;
  main.innerHTML = html;

  // Name field: update the model + the tab label directly, without a full re-render (would steal focus mid-type).
  const nameInput = document.getElementById('shipNameInput');
  nameInput.oninput = (e)=>{
    s.name = e.target.value;
    const activeTab = document.querySelector('#fitShipTabs button.active');
    if(activeTab) activeTab.textContent = `${s.type[0]} ${s.id.replace('S','')} — ${shipLabel(s)}`;
  };

  // Build the palette: every weapon type used anywhere in the ship's slot categories, deduplicated.
  const paletteEl = document.getElementById('fitPalette');
  const seen = new Set();
  SLOT_CATEGORIES.forEach(cat=>cat.options.forEach(w=>seen.add(w)));
  [...seen].forEach(wname=>{
    const w = WEAPONS[wname];
    // A weapon lights up when a compatible empty (or, for reassignment, any) slot is currently selected.
    const isSelected = fitSelection && fitSelection.type==='weapon' && fitSelection.weapon===wname;
    const isEligible = fitSelection && fitSelection.type==='slot' && fitSelection.shipId===s.id &&
      slotAccepts(SLOT_CATEGORIES.find(c=>c.key===fitSelection.catKey), wname, s);
    const item = document.createElement('div');
    item.className = ['paletteItem', isSelected?'selected':'', isEligible?'eligible':''].filter(Boolean).join(' ');
    item.draggable = true;
    item.dataset.weapon = wname;
    item.innerHTML = `${weaponIconSVG(wname)}<span class="pname">${wname}</span><span class="pstat">R${w.range} D${w.damage}</span>`;
    item.addEventListener('click', ()=> fitWeaponClick(s, wname));
    item.addEventListener('dragstart', (e)=>{
      e.dataTransfer.setData('text/plain', wname);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', ()=> item.classList.remove('dragging'));
    paletteEl.appendChild(item);
  });

  // Wire up every slot: click-to-place, plus drag & drop.
  main.querySelectorAll('.fitSlot').forEach(slotEl=>{
    const cat = SLOT_CATEGORIES.find(c=>c.key===slotEl.dataset.cat);
    const idx = parseInt(slotEl.dataset.idx);
    slotEl.addEventListener('click', ()=> fitSlotClick(s, cat, idx));
    slotEl.addEventListener('dragover', (e)=>{
      const wname = getDraggingWeapon();
      if(wname && slotAccepts(cat, wname, s)){
        e.preventDefault();
        slotEl.classList.add('dragover');
      }
    });
    slotEl.addEventListener('dragleave', ()=> slotEl.classList.remove('dragover'));
    slotEl.addEventListener('drop', (e)=>{
      e.preventDefault();
      slotEl.classList.remove('dragover');
      const wname = e.dataTransfer.getData('text/plain');
      if(!slotAccepts(cat, wname, s)) return; // incompatible mount, reject the drop
      fitAssign(s, cat.key, idx, wname);
      fitSelection = null;
      renderFitmentScreen();
    });
  });
}
function getDraggingWeapon(){
  const el = document.querySelector('.paletteItem.dragging');
  return el ? el.dataset.weapon : null;
}

/* ============================== LOGGING ============================== */
function logMsg(cls, text){
  const log = document.getElementById('log');
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

/* ============================== GEOMETRY HELPERS ============================== */
function normDeg(d){ d = d%360; if(d<0) d+=360; return d; }
function angDiff(a,b){ // smallest signed difference a-b in (-180,180]
  let d = normDeg(a-b);
  if(d>180) d-=360;
  return d;
}
function bearingFromTo(ax,ay,bx,by){
  // 0 = North(-y), 90 = East(+x)
  const dx = bx-ax, dy = by-ay;
  let deg = Math.atan2(dx,-dy)/DEG2RAD;
  return normDeg(deg);
}
function dist(ax,ay,bx,by){ return Math.hypot(ax-bx, ay-by); }

function arcOfBearing(shipHeading, bearingFromShipToOther){
  // returns which of the ship's own 4 arcs faces a given absolute bearing (bearing pointing FROM ship TO other)
  const rel = normDeg(bearingFromShipToOther - shipHeading);
  if(rel>=315 || rel<45) return 'prow';
  if(rel>=45 && rel<135) return 'starboard';
  if(rel>=135 && rel<225) return 'stern';
  return 'port';
}
function inBroadsideArc(shipHeading, bearing, side){
  const rel = normDeg(bearing - shipHeading);
  if(side==='starboard') return rel>=45 && rel<135;
  return rel>=225 && rel<315; // port
}
function inTurretArc(turretFacing, bearing){
  const d = angDiff(bearing, turretFacing);
  return Math.abs(d) <= TURRET_CONE_HALF; // 25 deg cone total
}

/* ============================== RESIZE / RENDER ============================== */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
function resizeCanvas(){
  const wrap = document.getElementById('canvasWrap');
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  render();
}
window.addEventListener('resize', resizeCanvas);

function fitScale(){
  return Math.min(canvas.width/(BOARD_W*PX), canvas.height/(BOARD_H*PX));
}
function worldToScreen(x,y){
  const scale = fitScale() * state.zoom * PX;
  return {
    x: canvas.width/2 + (x - state.viewCenter.x)*scale,
    y: canvas.height/2 + (y - state.viewCenter.y)*scale,
    scale
  };
}
function screenToWorld(mx,my){
  const scale = fitScale() * state.zoom * PX;
  return {
    x: state.viewCenter.x + (mx - canvas.width/2)/scale,
    y: state.viewCenter.y + (my - canvas.height/2)/scale
  };
}
function clampViewCenter(){
  // don't let the camera wander pointlessly far past the board edges
  const pad = 60;
  state.viewCenter.x = Math.max(-pad, Math.min(BOARD_W+pad, state.viewCenter.x));
  state.viewCenter.y = Math.max(-pad, Math.min(BOARD_H+pad, state.viewCenter.y));
}

function allShips(){ return [...state.fleets.player, ...state.fleets.ai].filter(s=>!s.destroyed); }
function shipById(id){ return allShips().find(s=>s.id===id) || [...state.fleets.player,...state.fleets.ai].find(s=>s.id===id); }

function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // Advance the on-map ship sailing-sprite clock once per frame, before any ship draws.
  const nowTs = performance.now();
  const mapDt = mapSpriteLastTime==null ? 0 : (nowTs - mapSpriteLastTime)/1000;
  mapSpriteLastTime = nowTs;
  mapSpriteClock += mapDt;
  const scaleInfo = worldToScreen(0,0);
  const scale = scaleInfo.scale;
  turretLabelRects.length = 0; // off-target labels placed so far this frame (so later ones can dodge them)
  // board rect
  const tl = worldToScreen(0,0), br = worldToScreen(BOARD_W,BOARD_H);
  // Water texture, drawn here (before anything else) so it scales and pans with the board
  // exactly like the grid and everything on it, rather than sitting fixed behind the canvas.
  if(gameplayBgImg.complete){
    // cover-fit: crop the water texture to the board's shape instead of stretching it
    const iw = gameplayBgImg.naturalWidth || 1, ih = gameplayBgImg.naturalHeight || 1, ba = BOARD_W/BOARD_H;
    let sw = iw, sh = ih;
    if(iw/ih > ba) sw = ih*ba; else sh = iw/ba;
    ctx.drawImage(gameplayBgImg, (iw-sw)/2, (ih-sh)/2, sw, sh, tl.x, tl.y, br.x-tl.x, br.y-tl.y);
  }
  ctx.strokeStyle = '#123249'; ctx.lineWidth=2;
  ctx.strokeRect(tl.x, tl.y, br.x-tl.x, br.y-tl.y);
  ctx.fillStyle = 'rgba(10,30,45,0.18)';
  ctx.fillRect(tl.x,tl.y,br.x-tl.x,br.y-tl.y);
  // grid every 50in
  ctx.strokeStyle='rgba(255,255,255,0.09)'; ctx.lineWidth=1;
  for(let gx=0; gx<=BOARD_W; gx+=50){
    const a=worldToScreen(gx,0), b=worldToScreen(gx,BOARD_H);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
  for(let gy=0; gy<=BOARD_H; gy+=50){
    const a=worldToScreen(0,gy), b=worldToScreen(BOARD_W,gy);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
  // sun marker
  drawSun(scale);
  // islands
  drawIslands();
  btDrawZones(scale);
  // mines
  state.mines.forEach(m=>{
    const p = worldToScreen(m.x,m.y);
    // Dotted ring showing how close a ship has to get to set this mine off (drawn to true scale,
    // so it grows and shrinks with zoom, unlike the fixed-size marker in its middle).
    ctx.save();
    ctx.setLineDash([3,5]);
    ctx.strokeStyle='rgba(240,205,100,0.95)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(p.x,p.y,MINE_TRIGGER_RANGE*scale,0,Math.PI*2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle='#4a2c1a'; ctx.strokeStyle='#e8c15a'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(p.x,p.y,5,0,7); ctx.fill(); ctx.stroke();
  });
  // in-flight torpedo lanes (both sides) — visible all through the next Movement phase so ships can dodge
  drawTorpedoLanes(scale);
  // movement draft ghost path
  if(state.moveDraft && state.selectedShipId && (state.phase==='movement' || state.phase==='firing')){
    const gsel = shipById(state.selectedShipId);
    if(gsel && canPlotMoveNow(gsel)) drawMoveDraftGhost();
  }
  if(state.phase==='firing') drawExtraMoveGhosts(scale);
  // Paths and destination silhouettes for every ship you've already confirmed this movement
  // phase, so you can see exactly where they're headed while you're still plotting the rest.
  if(state.phase==='movement'){
    drawConfirmedMoveGhosts(scale);
  }
  // dashed red lines from each locked-on ship to its target (under the ships themselves)
  drawTargetLines(scale);
  // drift / stuck-helm arrows for crippled ships (under the ships themselves)
  drawCritArrows(scale);
  // ships
  allShips().forEach(s=>{
    if(state.phase==='deploy' && !(s.side==='player' && (s.placed || s.depPreview))) return; // the enemy deployment stays hidden
    drawShip(s, scale);
  });
  btDrawDeployOverlay(scale);
  // selected ship: red firing arcs first, blue movement reach fan layered on top of them
  if(state.selectedShipId){
    const s = shipById(state.selectedShipId);
    if(s && s.side==='player' && !s.destroyed && (state.phase!=='deploy' || s.placed || s.depPreview)){
      if(s.grounded && s.grounded.phase==='ready' && state.phase==='movement'){
        drawRefloatRange(s, scale);
      } else if(state.phase==='special' && s.specialOrderMode==='course' && !s.courseConfirmed){
        drawCourseAdjustRange(s, scale);
      } else {
        drawWeaponArcs(s, scale);
        if(canPlotMoveNow(s) && !s.crit) drawReachFan(s, scale);
      }
    }
  }
  // turret cones (and off-target arrows) for locked-on ships that aren't the selected one
  drawOtherTurretCones(scale);
  // hit/miss animations — explosions and water splashes — drawn on top of everything else
  drawEffects(scale);
  // box-select rectangle overlay (drawn in raw screen space, on top of everything)
  if(false && typeof leftDrag!=='undefined' && leftDrag && leftDrag.moved){ // (box-select removed)
    const x0=Math.min(leftDrag.startMx,leftDrag.curMx), y0=Math.min(leftDrag.startMy,leftDrag.curMy);
    const w=Math.abs(leftDrag.curMx-leftDrag.startMx), h=Math.abs(leftDrag.curMy-leftDrag.startMy);
    ctx.save();
    ctx.fillStyle='rgba(63,208,255,0.12)';
    ctx.strokeStyle='rgba(63,208,255,0.9)';
    ctx.lineWidth=1;
    ctx.setLineDash([4,3]);
    ctx.fillRect(x0,y0,w,h);
    ctx.strokeRect(x0,y0,w,h);
    ctx.restore();
  }
  positionFloatingBox();
  drawShipSpriteBox();
  updateFiringWindows();
  updateHitWindows();
  updateMineInspector();
  updateCritPopups();
}

/* ============================== SHIP STAT-PANEL SPRITE ANIMATION ============================== */
let spriteBoxLastTime = null;
function drawShipSpriteBox(){
  const canvas = document.getElementById('shipSpriteCanvas');
  if(!canvas){ spriteBoxLastTime = null; return; } // panel not showing right now
  const s = shipById(state.selectedShipId);
  const spr = s ? SHIP_SPRITES[s.type] : null;
  if(!spr || !spr.img.complete) return; // no art for this ship type yet
  const now = performance.now();
  const dt = spriteBoxLastTime==null ? 0 : (now - spriteBoxLastTime)/1000;
  spriteBoxLastTime = now;
  spriteClock += dt;
  const frameDur = 1/spr.fps;
  const frameIndex = Math.floor(spriteClock/frameDur) % spr.frameCount;
  const c2d = canvas.getContext('2d');
  c2d.clearRect(0,0,canvas.width,canvas.height);
  const scale = Math.min(canvas.width/spr.cellW, canvas.height/spr.cellH);
  const dw = spr.cellW*scale, dh = spr.cellH*scale;
  const dx = (canvas.width-dw)/2, dy = canvas.height-dh;
  c2d.drawImage(spr.img, frameIndex*spr.cellW, 0, spr.cellW, spr.cellH, dx, dy, dw, dh);
}

/* ============================== DECK GUN FIRING WINDOWS ============================== */
function makeFiringWindowEl(win){
  const el = document.createElement('div');
  el.className = 'firingWindow';
  el.innerHTML = `<div class="firingWindowTitle">FIRING WINDOW</div><canvas width="${FIRING_WINDOW_W}" height="${FIRING_WINDOW_H}"></canvas>`;
  document.getElementById('firingWindowsLayer').appendChild(el);
  win.el = el;
  win.canvasEl = el.querySelector('canvas');
}
// Greedy non-overlap layout: each window prefers a spot just off its shooter's screen position,
// then gets nudged down (and across, if it runs out of vertical room) past any window already
// placed this frame, so open Firing Windows never overlap each other.
function layoutFiringWindows(openList){
  const winW = FIRING_WINDOW_W, winH = FIRING_WINDOW_H+22;
  const wrap = document.getElementById('canvasWrap');
  const maxW = wrap.clientWidth, maxH = wrap.clientHeight;
  // Each window in a cascade overlaps the one before it by 70%, so it only steps 30% of the
  // window's size further down-and-right than its predecessor.
  const stepX = winW*0.3, stepY = winH*0.3;
  const scale = worldToScreen(0,0).scale;
  // Group by SHIP *and* WEAPON TYPE — each firing ship gets its own cascade per weapon type
  // it used this round (Cannons and Autoguns from the same ship become two separate waterfalls,
  // both anchored near that ship), and a different ship's shots never merge into someone else's.
  const groups = new Map();
  openList.forEach(win=>{
    const key = win.shooter.id + '|' + win.weaponKey;
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(win);
  });
  const placedBounds = [];
  const boundsOverlap = (a,b)=> a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  groups.forEach(wins=>{
    const shooter = wins[0].shooter;
    const sp = worldToScreen(shooter.x, shooter.y);
    // Start the cascade clear of the firing ship's own sprite: push the anchor out along a
    // fixed up-right diagonal by the ship's on-screen radius plus half the window's size, so
    // even the first (closest) window in the cascade doesn't sit over the hull.
    const shipRadius = Math.max(shooter.hullLen, shooter.hullWide) * scale * 0.6;
    const clearance = shipRadius + Math.max(winW,winH)*0.5 + 12;
    const cascadeW = winW + stepX*(wins.length-1), cascadeH = winH + stepY*(wins.length-1);
    let anchorX = Math.max(4, Math.min(sp.x + clearance*Math.SQRT1_2, maxW - cascadeW - 4));
    let anchorY = Math.max(4, Math.min(sp.y - clearance*Math.SQRT1_2 - winH/2, maxH - cascadeH - 4));
    let tries = 0;
    while(tries<20){
      const bounds = {x0:anchorX, y0:anchorY, x1:anchorX+cascadeW, y1:anchorY+cascadeH};
      if(!placedBounds.some(b=> boundsOverlap(bounds,b))) break;
      anchorY += winH*0.5;
      if(anchorY + cascadeH > maxH-4){ anchorY = 4; anchorX += winW*0.5; }
      tries++;
    }
    anchorX = Math.max(4, Math.min(anchorX, maxW - winW - 4));
    anchorY = Math.max(4, Math.min(anchorY, maxH - winH - 4));
    placedBounds.push({x0:anchorX, y0:anchorY, x1:anchorX+cascadeW, y1:anchorY+cascadeH});
    wins.forEach((win,i)=>{
      const x = Math.max(4, Math.min(anchorX + i*stepX, maxW - winW - 4));
      const y = Math.max(4, Math.min(anchorY + i*stepY, maxH - winH - 4));
      win.el.style.left = x+'px';
      win.el.style.top = y+'px';
      win.el.style.zIndex = String(100 + i); // later shots in the cascade sit on top
    });
  });
}
function updateFiringWindows(){
  if(!firingWindows.length || firingBatchStartTime==null) return;
  const now = performance.now();
  const elapsed = now - firingBatchStartTime;
  firingWindows.forEach(win=>{
    if(!win.opened && elapsed >= win.openDelay){
      win.opened = true;
      makeFiringWindowEl(win);
    }
  });
  const openList = firingWindows.filter(w=>w.opened);
  if(openList.length) layoutFiringWindows(openList);
  // Deterministic: the whole batch starts playing once the LAST window's open delay has passed.
  const groupPlayStart = firingBatchStartTime + Math.max(...firingWindows.map(w=>w.openDelay));
  if(now >= groupPlayStart + FIRING_WINDOW_PLAY_MS){
    firingWindows.forEach(w=>{ if(w.el) w.el.remove(); });
    firingWindows = [];
    firingBatchStartTime = null;
    releasePendingEffects(); // hit/miss impacts only show once every firing window has closed
    if(firingBatchQueue.length) startFiringBatch(firingBatchQueue.shift());
    return;
  }
  const playT = now - groupPlayStart;
  openList.forEach(win=>{
    const spec = FIRING_WINDOW_WEAPONS[win.weaponKey];
    if(!spec || !spec.img.complete) return;
    const frame = playT < 0 ? 0 : Math.min(spec.frameCount-1, Math.floor(playT/FIRING_WINDOW_PLAY_MS*spec.frameCount));
    const c2d = win.canvasEl.getContext('2d');
    c2d.clearRect(0,0,FIRING_WINDOW_W,FIRING_WINDOW_H);
    const scale = Math.min(FIRING_WINDOW_W/spec.cellW, FIRING_WINDOW_H/spec.cellH);
    const dw = spec.cellW*scale, dh = spec.cellH*scale;
    const dx = (FIRING_WINDOW_W-dw)/2, dy = (FIRING_WINDOW_H-dh)/2;
    c2d.drawImage(spec.img, frame*spec.cellW, 0, spec.cellW, spec.cellH, dx, dy, dw, dh);
  });
}

/* ============================== SHIP-HIT BRIDGE-VIEW WINDOWS ============================== */
function makeHitWindowEl(win){
  const el = document.createElement('div');
  el.className = 'firingWindow';
  el.innerHTML = `<div class="firingWindowTitle">FIRING WINDOW</div><canvas width="${FIRING_WINDOW_W}" height="${FIRING_WINDOW_H}"></canvas>`;
  document.getElementById('firingWindowsLayer').appendChild(el);
  win.el = el;
  win.canvasEl = el.querySelector('canvas');
}
// All hit windows for a batch open together (no stagger — every ship hit this round shows its
// impact at once), each anchored near its own ship and kept clear of that ship's sprite, using
// the same clearance and mutual non-overlap approach as the gun Firing Windows.
function flushHitWindowBatch(impacts){
  hitWindows.forEach(w=>{ if(w.el) w.el.remove(); }); // never orphan a batch that's still showing
  hitBatchStartTime = performance.now();
  hitWindows = impacts.map(({target,kind})=>({
    id: firingWindowNextId++,
    target,
    // Gunfire hit -> the one bridge-hit clip. Torpedo hit / gunfire miss -> one of two clips,
    // picked at random. Torpedo miss (incl. a "near miss" call-out) -> the one dedicated clip.
    // Fixed for this window's whole playback either way.
    spec: kind==='hit' ? HIT_WINDOW_SPEC
        : kind==='torpedoHit' ? TORPEDO_HIT_SPECS[Math.floor(Math.random()*TORPEDO_HIT_SPECS.length)]
        : kind==='sinking' ? SINK_WINDOW_SPEC
        : kind==='torpedoMiss' ? TORPEDO_MISS_SPEC
        : MISS_WINDOW_SPECS[Math.floor(Math.random()*MISS_WINDOW_SPECS.length)],
    el:null, canvasEl:null
  }));
}
function layoutHitWindows(){
  const winW = FIRING_WINDOW_W, winH = FIRING_WINDOW_H+22;
  const wrap = document.getElementById('canvasWrap');
  const maxW = wrap.clientWidth, maxH = wrap.clientHeight;
  const scale = worldToScreen(0,0).scale;
  const overlapAllow = 0.2;
  const effW = winW*(1-overlapAllow), effH = winH*(1-overlapAllow);
  const insetX = (winW-effW)/2, insetY = (winH-effH)/2;
  const collides = (ax,ay,bx,by)=>{
    const ax0=ax+insetX, ay0=ay+insetY, ax1=ax0+effW, ay1=ay0+effH;
    const bx0=bx+insetX, by0=by+insetY, bx1=bx0+effW, by1=by0+effH;
    return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
  };
  const placed = [];
  hitWindows.forEach(win=>{
    const sp = worldToScreen(win.target.x, win.target.y);
    const shipRadius = Math.max(win.target.hullLen, win.target.hullWide) * scale * 0.6;
    const clearance = shipRadius + Math.max(winW,winH)*0.5 + 12;
    let x = Math.max(4, Math.min(sp.x + clearance*Math.SQRT1_2, maxW - winW - 4));
    let y = Math.max(4, Math.min(sp.y - clearance*Math.SQRT1_2 - winH/2, maxH - winH - 4));
    let tries = 0;
    while(placed.some(p=> collides(x,y,p.x,p.y)) && tries<40){
      y += effH;
      if(y+winH > maxH-4){ y = 4; x += effW; }
      tries++;
    }
    placed.push({x,y});
    win.el.style.left = x+'px';
    win.el.style.top = y+'px';
  });
}
function updateHitWindows(){
  if(!hitWindows.length || hitBatchStartTime==null) return;
  if(!hitWindows[0].el){ hitWindows.forEach(makeHitWindowEl); layoutHitWindows(); }
  const now = performance.now();
  const elapsed = now - hitBatchStartTime;
  const playMs = hitWindows[0].spec.ms || BRIDGE_HIT_PLAY_MS;
  if(elapsed >= playMs){
    hitWindows.forEach(w=>{ if(w.el) w.el.remove(); });
    hitWindows = [];
    hitBatchStartTime = null;
    return;
  }
  hitWindows.forEach(win=>{
    const spec = win.spec;
    if(!spec.img.complete) return;
    const frame = Math.min(spec.frameCount-1, Math.floor(elapsed/playMs*spec.frameCount));
    const scale = Math.min(FIRING_WINDOW_W/spec.cellW, FIRING_WINDOW_H/spec.cellH);
    const dw = spec.cellW*scale, dh = spec.cellH*scale;
    const dx = (FIRING_WINDOW_W-dw)/2, dy = (FIRING_WINDOW_H-dh)/2;
    const c2d = win.canvasEl.getContext('2d');
    c2d.clearRect(0,0,FIRING_WINDOW_W,FIRING_WINDOW_H);
    c2d.drawImage(spec.img, frame*spec.cellW, 0, spec.cellW, spec.cellH, dx, dy, dw, dh);
  });
}

/* ============================== MINE INSPECTOR (click a mine to watch it) ============================== */
// Nearest laid mine to a screen point, within a generous click radius — mines are drawn as a
// small fixed-size marker, so this tolerance is deliberately larger than the marker itself.
function mineAtScreenPoint(mx, my){
  let best=null, bestD=1e9;
  state.mines.forEach(m=>{
    const p = worldToScreen(m.x,m.y);
    const d = Math.hypot(p.x-mx,p.y-my);
    if(d<12 && d<bestD){ best=m; bestD=d; }
  });
  return best;
}
function openMineInspector(mine){
  if(mineInspectWindow && mineInspectWindow.mineId===mine.id) return; // already watching this one
  closeMineInspector();
  mineInspectWindow = { mineId: mine.id, el:null, canvasEl:null };
  mineInspectClock = 0;
  mineInspectLastTime = null;
}
function closeMineInspector(){
  if(mineInspectWindow && mineInspectWindow.el) mineInspectWindow.el.remove();
  mineInspectWindow = null;
}
function updateMineInspector(){
  if(!mineInspectWindow) return;
  const mine = state.mines.find(m=>m.id===mineInspectWindow.mineId);
  if(!mine){ closeMineInspector(); return; } // detonated (or otherwise removed) while being watched
  if(!mineInspectWindow.el){
    const el = document.createElement('div');
    el.className = 'firingWindow';
    el.innerHTML = `<div class="firingWindowTitle">FIRING WINDOW</div><canvas width="${FIRING_WINDOW_W}" height="${FIRING_WINDOW_H}"></canvas>`;
    document.getElementById('firingWindowsLayer').appendChild(el);
    mineInspectWindow.el = el;
    mineInspectWindow.canvasEl = el.querySelector('canvas');
  }
  const wrap = document.getElementById('canvasWrap');
  const maxW = wrap.clientWidth, maxH = wrap.clientHeight;
  const winW = FIRING_WINDOW_W, winH = FIRING_WINDOW_H+22;
  const p = worldToScreen(mine.x, mine.y);
  const clearance = 5 /* mine marker's own screen radius */ + Math.max(winW,winH)*0.5 + 12;
  const x = Math.max(4, Math.min(p.x + clearance*Math.SQRT1_2, maxW-winW-4));
  const y = Math.max(4, Math.min(p.y - clearance*Math.SQRT1_2 - winH/2, maxH-winH-4));
  mineInspectWindow.el.style.left = x+'px';
  mineInspectWindow.el.style.top = y+'px';
  const now = performance.now();
  const dt = mineInspectLastTime==null ? 0 : (now-mineInspectLastTime)/1000;
  mineInspectLastTime = now;
  mineInspectClock += dt;
  const spec = MINE_WATCH_SPEC;
  if(!spec.img.complete) return;
  const tMod = (mineInspectClock*1000) % MINE_WATCH_LOOP_MS;
  const frame = Math.min(spec.frameCount-1, Math.floor(tMod/MINE_WATCH_LOOP_MS*spec.frameCount));
  const scale = Math.min(FIRING_WINDOW_W/spec.cellW, FIRING_WINDOW_H/spec.cellH);
  const dw = spec.cellW*scale, dh = spec.cellH*scale;
  const dx = (FIRING_WINDOW_W-dw)/2, dy = (FIRING_WINDOW_H-dh)/2;
  const c2d = mineInspectWindow.canvasEl.getContext('2d');
  c2d.clearRect(0,0,FIRING_WINDOW_W,FIRING_WINDOW_H);
  c2d.drawImage(spec.img, frame*spec.cellW, 0, spec.cellW, spec.cellH, dx, dy, dw, dh);
}

/* ============================== HIT / MISS ANIMATIONS ============================== */
function spawnEffect(type, x, y){
  const duration = type==='explosion' ? 750 : 600;
  state.effects.push({type, x, y, start: performance.now(), duration});
}

function drawEffects(scale){
  if(!state.effects.length) return;
  const now = performance.now();
  state.effects = state.effects.filter(fx=>{
    const t = (now - fx.start) / fx.duration;
    if(t >= 1) return false;
    const p = worldToScreen(fx.x, fx.y);
    if(fx.type==='explosion') drawExplosionFX(p, t);
    else drawSplashFX(p, t);
    return true;
  });
}

function drawExplosionFX(p, t){
  ctx.save();
  const maxR = 26;
  const r = maxR * (0.35 + 0.65*Math.min(1, t*2.2));
  const alpha = 1 - t;
  const grad = ctx.createRadialGradient(p.x,p.y,0, p.x,p.y,r);
  grad.addColorStop(0, `rgba(255,245,200,${alpha})`);
  grad.addColorStop(0.35, `rgba(255,140,40,${alpha*0.9})`);
  grad.addColorStop(0.7, `rgba(200,50,20,${alpha*0.6})`);
  grad.addColorStop(1, `rgba(120,20,10,0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(p.x,p.y,r,0,7);
  ctx.fill();
  const sparks = 7;
  for(let i=0;i<sparks;i++){
    const ang = (i/sparks)*Math.PI*2 + t*1.5;
    const len = r*(1.1+0.3*Math.sin(i*13+t*9));
    ctx.strokeStyle = `rgba(255,205,120,${alpha*0.7})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x,p.y);
    ctx.lineTo(p.x+Math.cos(ang)*len, p.y+Math.sin(ang)*len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSplashFX(p, t){
  ctx.save();
  const alpha = 1 - t;
  const ringR = 5 + 16*t;
  ctx.strokeStyle = `rgba(210,235,255,${alpha*0.85})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x,p.y,ringR,0,7);
  ctx.stroke();
  const drops = 6;
  for(let i=0;i<drops;i++){
    const ang = (i/drops)*Math.PI*2 + i*1.7;
    const dr = ringR*0.55;
    const rise = 10*Math.sin(Math.min(1,t*2)*Math.PI); // droplets pop up then fall back
    ctx.fillStyle = `rgba(225,242,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x+Math.cos(ang)*dr, p.y+Math.sin(ang)*dr - rise, 1.6, 0, 7);
    ctx.fill();
  }
  ctx.restore();
}

let animLoopRunning = false;
function startAnimLoop(){
  if(animLoopRunning) return;
  animLoopRunning = true;
  (function loop(){
    render();
    requestAnimationFrame(loop);
  })();
}

// Darkens the portion of a firing-arc wedge that an island blocks line of sight into — sampled
// by casting rays across the wedge's angular span and finding where each first hits land.
// Adds the torpedo lane's outline to the current canvas path (it must already have had beginPath called).
function traceTorpedoLane(tp){
  torpedoLaneWorldOutline(tp).forEach((q,i)=>{
    const sp = worldToScreen(q.x, q.y);
    if(i===0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
  });
  ctx.closePath();
}
function drawArcIslandShadow(shipX, shipY, p, centerDeg, halfWidthDeg, radiusInches, scale){
  const steps = Math.max(8, Math.round(halfWidthDeg/2));
  const hits = [];
  for(let i=0;i<=steps;i++){
    const a = centerDeg - halfWidthDeg + (i/steps)*halfWidthDeg*2;
    hits.push({ a, hitDist: rayIslandHitDistance(shipX, shipY, a, radiusInches) });
  }
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,10,0.6)';
  for(let i=0;i<steps;i++){
    const h0 = hits[i], h1 = hits[i+1];
    if(h0.hitDist==null && h1.hitDist==null) continue; // this slice has clear line of sight
    const r0near = (h0.hitDist!=null ? h0.hitDist : radiusInches) * scale;
    const r1near = (h1.hitDist!=null ? h1.hitDist : radiusInches) * scale;
    const rOuter = radiusInches * scale;
    const rad0 = (h0.a-90)*DEG2RAD, rad1 = (h1.a-90)*DEG2RAD;
    ctx.beginPath();
    ctx.moveTo(p.x+Math.cos(rad0)*r0near, p.y+Math.sin(rad0)*r0near);
    ctx.lineTo(p.x+Math.cos(rad0)*rOuter, p.y+Math.sin(rad0)*rOuter);
    ctx.lineTo(p.x+Math.cos(rad1)*rOuter, p.y+Math.sin(rad1)*rOuter);
    ctx.lineTo(p.x+Math.cos(rad1)*r1near, p.y+Math.sin(rad1)*r1near);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawWeaponArcs(s, scale){
  const dp = getDrawPos(s);
  const p = worldToScreen(dp.x,dp.y);
  const drawWedge = (centerDeg, halfWidthDeg, radiusInches, alpha)=>{
    if(radiusInches<=0) return;
    const R = radiusInches*scale;
    const a0 = (centerDeg-halfWidthDeg-90)*DEG2RAD;
    const a1 = (centerDeg+halfWidthDeg-90)*DEG2RAD;
    ctx.beginPath();
    ctx.moveTo(p.x,p.y);
    ctx.arc(p.x,p.y,R,a0,a1);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,60,60,${alpha})`;
    ctx.strokeStyle = 'rgba(255,90,90,0.55)';
    ctx.lineWidth = 1;
    ctx.fill(); ctx.stroke();
    if(state.islands.length) drawArcIslandShadow(dp.x, dp.y, p, centerDeg, halfWidthDeg, radiusInches, scale);
  };
  const drawArcLabel = (centerDeg, radiusInches, text)=>{
    const labelR = Math.min(radiusInches*0.45, 70) * scale;
    const ang = (centerDeg-90)*DEG2RAD;
    const lx = p.x + Math.cos(ang)*labelR;
    const ly = p.y + Math.sin(ang)*labelR;
    ctx.save();
    ctx.font = 'bold 10px Segoe UI';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 3;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(text, lx, ly);
    ctx.restore();
  };
  // Broadside arcs: fixed 90° port/starboard wedges, sized to the longest-ranged weapon mounted there.
  const arcOn = s.arcShow || {};   // firing arcs start hidden; the stat window buttons switch them on
  const starboardFitted = !arcOn.broadside ? [] : s.broadsideStarboard.filter(Boolean);
  if(starboardFitted.length){
    const rng = Math.max(...starboardFitted.map(e=>WEAPONS[e.weapon].range));
    const centerDeg = normDeg(dp.heading+90);
    drawWedge(centerDeg, 45, rng, 0.10);
    drawArcLabel(centerDeg, rng, 'STARBOARD');
  }
  const portFitted = !arcOn.broadside ? [] : s.broadsidePort.filter(Boolean);
  if(portFitted.length){
    const rng = Math.max(...portFitted.map(e=>WEAPONS[e.weapon].range));
    const centerDeg = normDeg(dp.heading+270);
    drawWedge(centerDeg, 45, rng, 0.10);
    drawArcLabel(centerDeg, rng, 'PORT');
  }
  // Turret arc: 25° cone in front of current turret facing (independent of hull heading).
  const turretFitted = (!arcOn.turret || deadWater(s)) ? [] : s.turretWeapons.filter(Boolean);
  if(turretFitted.length){
    drawWedge(getDrawTurretFacing(s), TURRET_CONE_HALF, Math.max(...turretFitted.map(e=>WEAPONS[e.weapon].range)), 0.18);
    if(turretOverlayActive()) drawTurretOffTargetIndicator(s, scale);
  }
  // Torpedo lane: a 7° cone from the prow that stops widening at 15" and runs on as a rectangle (see torpedoLaneOutline).
  const torpFitted = (!arcOn.torpedo || deadWater(s)) ? [] : s.torpedoTubes.filter(t=>t.weapon);
  if(torpFitted.length){
    const lane = {x:dp.x, y:dp.y, heading:dp.heading, halfWidth:TORPEDO_ARC_HALF, range:Math.max(...torpFitted.map(t=>WEAPONS[t.weapon].range))};
    ctx.beginPath(); traceTorpedoLane(lane);
    ctx.fillStyle = 'rgba(255,60,60,0.07)'; ctx.strokeStyle = 'rgba(255,90,90,0.55)'; ctx.lineWidth = 1;
    ctx.fill(); ctx.stroke();
    if(state.islands.length){
      // islands shade the part of the lane they hide, same as the other arcs — kept inside the lane's own outline
      ctx.save(); ctx.beginPath(); traceTorpedoLane(lane); ctx.clip();
      drawArcIslandShadow(dp.x, dp.y, p, dp.heading, TORPEDO_ARC_HALF, lane.range, scale);
      ctx.restore();
    }
  }
}

function drawSun(scale){
  const rad = state.sunDeg*DEG2RAD;
  const cx = BOARD_W/2, cy = BOARD_H/2;
  const R = Math.max(BOARD_W,BOARD_H);
  const sx = cx + R*Math.sin(rad), sy = cy - R*Math.cos(rad);
  // clamp to perimeter visually by projecting near edge
  const edgeDist = Math.min(BOARD_W,BOARD_H)/2 + 30;
  const p = worldToScreen(cx + edgeDist*Math.sin(rad), cy - edgeDist*Math.cos(rad));
  ctx.save();
  ctx.fillStyle='#e8c15a'; ctx.shadowColor='#e8c15a'; ctx.shadowBlur=20;
  ctx.beginPath(); ctx.arc(p.x,p.y,10,0,7); ctx.fill();
  ctx.restore();
}

// Every torpedo still in flight, drawn as the lane it was launched into. A ship that ends the next
// Movement phase outside its lane is safe from it; inside, the closest ship to the launch point is
// the one at risk. Several torpedoes from one ship share a single lane, drawn once with a count.
function drawTorpedoLanes(scale){
  // Launches the player has confirmed but not yet fired (they go when the phase ends) get a lighter "planned" lane.
  const planned = state.phase!=='special' ? [] : state.fleets.player
    .filter(sh=>!sh.destroyed && sh.torpConfirmed && (sh.torpSelected||[]).length)
    .map(sh=>({key:'plan:'+sh.id, planned:true, count:sh.torpSelected.length,
      tp:{ownerId:sh.id, side:'player', x:sh.x, y:sh.y, heading:sh.heading, halfWidth:TORPEDO_ARC_HALF, range:WEAPONS.Torpedo.range}}));
  if(!state.torpedoes.length && !planned.length) return;
  const groups = new Map();
  state.torpedoes.forEach(tp=>{
    const g = groups.get(tp.ownerId);
    if(g) g.count++; else groups.set(tp.ownerId, {tp, count:1, planned:false});
  });
  planned.forEach(p=> groups.set(p.key, {tp:p.tp, count:p.count, planned:true}));
  const tl = worldToScreen(0,0), br = worldToScreen(BOARD_W,BOARD_H);
  ctx.save();
  ctx.beginPath(); ctx.rect(tl.x, tl.y, br.x-tl.x, br.y-tl.y); ctx.clip();
  groups.forEach(({tp, planned:isPlanned})=>{
    const p = worldToScreen(tp.x, tp.y);
    const mine = tp.side==='player';
    ctx.beginPath();
    traceTorpedoLane(tp);
    ctx.fillStyle = isPlanned ? 'rgba(255,200,90,0.05)' : (mine ? 'rgba(255,170,60,0.09)' : 'rgba(255,80,80,0.10)');
    ctx.fill();
    ctx.setLineDash(isPlanned ? [3,6] : [8,6]);
    ctx.strokeStyle = isPlanned ? 'rgba(255,205,110,0.7)' : (mine ? 'rgba(255,180,70,0.8)' : 'rgba(255,100,100,0.85)');
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  });
  ctx.restore();
  ctx.save();
  ctx.font = '600 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  groups.forEach(({tp,count,planned:isPlanned})=>{
    const p = worldToScreen(tp.x, tp.y);
    const rad = tp.heading*DEG2RAD, off = tp.range*scale*0.22;
    const lx = p.x + Math.sin(rad)*off, ly = p.y - Math.cos(rad)*off;
    const mine = tp.side==='player';
    const label = `${isPlanned?'PLANNED':(mine?'YOUR':'ENEMY')} TORPEDO LANE${count>1?' x'+count:''}`;
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(8,16,24,0.7)';
    ctx.fillRect(lx-w/2, ly-8, w, 16);
    ctx.fillStyle = isPlanned ? '#ffd98a' : (mine ? '#ffb347' : '#ff7a7a');
    ctx.fillText(label, lx, ly);
    ctx.beginPath(); ctx.arc(p.x,p.y,4,0,7);
    ctx.fillStyle = isPlanned ? '#ffd98a' : (mine ? '#ffb347' : '#ff7a7a'); ctx.fill();
  });
  ctx.restore();
}
function drawIslands(){
  state.islands.forEach(isl=>{
    const sprite = ISLAND_SPRITES[isl.spriteIdx];
    if(sprite && sprite.img.complete){
      // Stretch the sprite over the polygon's own bounding box — since each island's collision
      // polygon is generated aspect-matched to its assigned sprite (see generateBlobPolygon),
      // this ends up close to a uniform scale, not a distorting stretch.
      const xs = isl.points.map(p=>p.x), ys = isl.points.map(p=>p.y);
      const wx0 = Math.min(...xs), wx1 = Math.max(...xs);
      const wy0 = Math.min(...ys), wy1 = Math.max(...ys);
      const p0 = worldToScreen(wx0, wy0), p1 = worldToScreen(wx1, wy1);
      ctx.drawImage(sprite.img, p0.x, p0.y, p1.x-p0.x, p1.y-p0.y);
      return;
    }
    // Fallback (sprite still loading, or missing): the original procedural blob fill.
    ctx.save();
    ctx.beginPath();
    isl.points.forEach((pt,i)=>{
      const p = worldToScreen(pt.x, pt.y);
      if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
    });
    ctx.closePath();
    ctx.fillStyle = '#3d6b3f';
    ctx.strokeStyle = '#274a29';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    // a lighter inset "shoreline" ring for a bit of texture
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    isl.points.forEach((pt,i)=>{
      const ix = isl.cx + (pt.x-isl.cx)*0.7, iy = isl.cy + (pt.y-isl.cy)*0.7;
      const p = worldToScreen(ix, iy);
      if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
    });
    ctx.closePath();
    ctx.fillStyle = '#5c8a4f';
    ctx.fill();
    ctx.restore();
    ctx.restore();
  });
}

function shipColor(s){ return s.side==='player' ? '#3fd0ff' : '#ff6b4a'; }

// All Ahead Full: the plotted extra move of each of your ships, drawn dashed until it is made after the shooting.
function drawExtraMoveGhosts(scale){
  state.fleets.player.forEach(s=>{
    if(s.destroyed || !s.extraPlan) return;
    const pts = computePath(s, s.extraPlan).points;
    const endPt = pts[pts.length-1];
    ctx.save();
    ctx.beginPath();
    pts.forEach((pt,i)=>{ const pp = worldToScreen(pt.x, pt.y); if(i===0) ctx.moveTo(pp.x,pp.y); else ctx.lineTo(pp.x,pp.y); });
    ctx.setLineDash([4,3]); ctx.strokeStyle='rgba(255,176,90,0.85)'; ctx.lineWidth=1.8; ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    const p = worldToScreen(endPt.x, endPt.y);
    const len = s.hullLen*scale, wid = s.hullWide*scale;
    ctx.save();
    ctx.translate(p.x,p.y); ctx.rotate(endPt.heading*DEG2RAD);
    ctx.beginPath();
    ctx.moveTo(0,-len/2); ctx.lineTo(wid/2, 0); ctx.lineTo(0, len/2); ctx.lineTo(-wid/2, 0);
    ctx.closePath();
    ctx.setLineDash([3,2]); ctx.fillStyle='rgba(255,176,90,0.16)'; ctx.strokeStyle='rgba(255,176,90,0.85)'; ctx.lineWidth=1.5;
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  });
}

// Ghost silhouette at the destination of a ship whose move is confirmed but hasn't swept yet —
// i.e. it's still visually "held" at its old spot (see drawShip's pending-hold logic). Distinct
// dashed-gold styling separates this from the live in-progress draft ghost (drawMoveDraftGhost).
function drawConfirmedMoveGhosts(scale){
  state.fleets.player.forEach(s=>{
    if(s.destroyed || !s.moveAnim || s.moveAnim.startTime!=null) return; // only pending, unswept moves
    const pts = s.moveAnim.points;
    const endPt = pts[pts.length-1];
    // The full path it's actually going to take, not just where it ends up.
    ctx.save();
    ctx.beginPath();
    pts.forEach((pt,i)=>{
      const pp = worldToScreen(pt.x, pt.y);
      if(i===0) ctx.moveTo(pp.x,pp.y); else ctx.lineTo(pp.x,pp.y);
    });
    ctx.setLineDash([4,3]);
    ctx.strokeStyle = 'rgba(232,193,90,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    const p = worldToScreen(endPt.x, endPt.y);
    const len = s.hullLen*scale, wid = s.hullWide*scale;
    ctx.save();
    ctx.translate(p.x,p.y);
    ctx.rotate(endPt.heading*DEG2RAD);
    ctx.beginPath();
    ctx.moveTo(0,-len/2);
    ctx.lineTo(wid/2, 0);
    ctx.lineTo(0, len/2);
    ctx.lineTo(-wid/2, 0);
    ctx.closePath();
    ctx.setLineDash([3,2]);
    ctx.fillStyle = 'rgba(232,193,90,0.14)';
    ctx.strokeStyle = 'rgba(232,193,90,0.65)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  });
}

// Single source of truth for "where is this ship actually drawn right now" — used both for
// rendering and for click/drag hit-testing, so a click always lands where the ship visually is,
// even mid-animation or mid-drag. (A previous bug let these two drift apart.)
function getDrawPos(s){
  if(s.depPreview){ return {x:s.depPreview.x, y:s.depPreview.y, heading:s.depPreview.heading}; }
  if(s.courseAdjustHeading!=null){
    return {x:s.x, y:s.y, heading:s.courseAdjustHeading};
  }
  if(s.moveDragPreview){
    return {x:s.moveDragPreview.x, y:s.moveDragPreview.y, heading:s.moveDragPreview.heading};
  }
  if(s.refloatPending){
    return {x:s.refloatPending.x, y:s.refloatPending.y, heading: s.refloatHeading!=null ? s.refloatHeading : s.heading};
  }
  if(s.moveAnim){
    if(s.moveAnim.startTime==null){
      const pt0 = s.moveAnim.points[0];
      return {x:pt0.x, y:pt0.y, heading:pt0.heading};
    }
    const el = performance.now() - s.moveAnim.startTime - (s.moveAnim.delayMs||0);
    if(el < 0){ const q0 = s.moveAnim.points[0]; return {x:q0.x, y:q0.y, heading:q0.heading}; }
    const t = el / s.moveAnim.duration;
    if(t >= 1){
      s.moveAnim = null;
    } else {
      const pts = s.moveAnim.points;
      const targetCum = t * pts[pts.length-1].cum;
      let pt = pts[0];
      for(let i=0;i<pts.length;i++){
        if(pts[i].cum <= targetCum) pt = pts[i]; else break;
      }
      return {x:pt.x, y:pt.y, heading:pt.heading};
    }
  }
  return {x:s.x, y:s.y, heading:s.heading};
}

// Where this ship's turret cone is POINTING right now: the settled facing, except while it's swinging
// onto its target during the end-of-Movement sweep (the logical facing updates at once; this only
// affects what gets drawn while the sweep plays, exactly like ship positions).
function getDrawTurretFacing(s){
  const a = s.turretAnim;
  if(a){
    if(a.startTime==null) return a.from;
    const t = (performance.now() - a.startTime) / a.duration;
    if(t < 1) return normDeg(a.from + a.delta*t);
    s.turretAnim = null;
  }
  // Not aimed at anything: the cone turns with the hull exactly as the hull is DRAWN turning, so it follows the
  // ship through a drag preview, a Course Adjustment drag, and the sweep itself.
  if(turretFollowsHull(s)) return normDeg(s.turretFacing + angDiff(getDrawPos(s).heading, turretSyncOf(s)));
  return s.turretFacing;
}

// ---- turret targeting overlays ----
// Dashed red line from each locked-on player ship to its target, following both ships while they sail.
function drawTargetLines(scale){
  if(state.gameOver) return;
  ctx.save();
  ctx.setLineDash([8,6]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,70,70,0.92)';
  state.fleets.player.forEach(s=>{
    if(s.destroyed || !s.targetConfirmed) return;
    const t = shipById(s.aimTargetId);
    if(!t || t.destroyed) return;
    const a = getDrawPos(s), b = getDrawPos(t);
    const pa = worldToScreen(a.x,a.y), pb = worldToScreen(b.x,b.y);
    ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
  });
  ctx.restore();
}
// Turret cones and off-target arrows are only meaningful once the turrets have had their chance to
// swing for the round — i.e. during the sweep and for the rest of the round — so they stay hidden while
// the player is still planning moves (otherwise every ship not yet turned would raise a false alarm).
function turretOverlayActive(){ return state.phase!=='movement' || state.sweepActive; }
const turretLabelRects = []; // screen rectangles of the off-target labels drawn so far this frame
function turretRangeOf(s){
  const fitted = s.turretWeapons.filter(Boolean);
  return fitted.length ? Math.max(...fitted.map(e=>WEAPONS[e.weapon].range)) : 0;
}
// The turret cone on its own (for ships that aren't the selected one, whose full arcs are drawn separately).
function drawTurretCone(s, scale){
  const R = turretRangeOf(s)*scale; if(R<=0) return;
  const dp = getDrawPos(s), p = worldToScreen(dp.x,dp.y), f = getDrawTurretFacing(s);
  ctx.beginPath(); ctx.moveTo(p.x,p.y);
  ctx.arc(p.x,p.y,R,(f-TURRET_CONE_HALF-90)*DEG2RAD,(f+TURRET_CONE_HALF-90)*DEG2RAD);
  ctx.closePath();
  ctx.fillStyle='rgba(255,60,60,0.14)'; ctx.strokeStyle='rgba(255,90,90,0.55)'; ctx.lineWidth=1;
  ctx.fill(); ctx.stroke();
}
function drawOtherTurretCones(scale){
  if(state.gameOver || !turretOverlayActive()) return;
  state.fleets.player.forEach(s=>{
    if(s.destroyed || s.id===state.selectedShipId || !s.targetConfirmed || !s.turretWeapons.some(Boolean) || deadWater(s) || !(s.arcShow && s.arcShow.turret)) return;
    const t = shipById(s.aimTargetId); if(!t || t.destroyed) return;
    drawTurretCone(s, scale);
    drawTurretOffTargetIndicator(s, scale);
  });
}
// If the turret couldn't get its cone onto the target: a small arrow off the side of the cone, bending
// the way the turret still has to turn toward the dashed red line, with how many degrees are left.
function drawTurretOffTargetIndicator(s, scale){
  if(s.side!=='player' || !s.targetConfirmed || !s.turretWeapons.some(Boolean)) return;
  const t = shipById(s.aimTargetId); if(!t || t.destroyed) return;
  const dpS = getDrawPos(s), dpT = getDrawPos(t);
  const f = getDrawTurretFacing(s);
  const diff = angDiff(bearingFromTo(dpS.x,dpS.y,dpT.x,dpT.y), f);
  const off = Math.abs(diff) - TURRET_CONE_HALF;      // degrees still to turn to bring the line inside the cone
  if(off <= 0) return;
  const sign = diff>0 ? 1 : -1;                       // + = clockwise
  const p = worldToScreen(dpS.x,dpS.y);
  const R = Math.max(30, Math.min(80, turretRangeOf(s)*scale*0.55));
  const startA = f + sign*TURRET_CONE_HALF;           // the cone's edge on the side the target is on
  const reach = Math.min(off, 35);                    // how far round the arrow runs
  const endA = startA + sign*reach;
  const phi = (deg)=>(deg-90)*DEG2RAD;
  ctx.save();
  ctx.strokeStyle='#ffd27a'; ctx.fillStyle='#ffd27a'; ctx.lineWidth=2.4; ctx.lineCap='round'; ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(p.x,p.y,R,phi(startA),phi(endA),sign<0); ctx.stroke();
  // arrowhead, pointing the way the turret has to turn
  const pe = phi(endA), tx = p.x+Math.cos(pe)*R, ty = p.y+Math.sin(pe)*R;
  const dx = -Math.sin(pe)*sign, dy = Math.cos(pe)*sign;   // direction of travel along the arc
  const nx = Math.cos(pe), ny = Math.sin(pe);              // radial
  ctx.beginPath();
  ctx.moveTo(tx+dx*7, ty+dy*7);
  ctx.lineTo(tx-dx*3+nx*5, ty-dy*3+ny*5);
  ctx.lineTo(tx-dx*3-nx*5, ty-dy*3-ny*5);
  ctx.closePath(); ctx.fill();
  // label — anchored just outside the arrow and running away from the ship (rather than centred on top of
  // the hull and the red line), so neighbouring ships' labels are far less likely to pile up
  const label = `${Math.ceil(off)} Degrees of rotation off of target`;
  const pm = phi(startA + sign*reach/2);
  const cx = Math.cos(pm), cy = Math.sin(pm);
  const lx = p.x + cx*(R+9), ly = p.y + cy*(R+9);
  const align = cx>0.3 ? 'left' : (cx<-0.3 ? 'right' : 'center');
  ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = align; ctx.textBaseline='middle';
  const w = ctx.measureText(label).width + 10;
  const bx = align==='left' ? lx-5 : (align==='right' ? lx-w+5 : lx-w/2);
  let by = align==='center' ? ly + (cy>0 ? 2 : -20) : ly-9;        // top/bottom arrows: label sits clear of the arrow
  // If it would land on top of another ship's label, nudge it down until it's clear.
  for(let tries=0; tries<8 && turretLabelRects.some(r=> bx < r.x+r.w && bx+w > r.x && by < r.y+r.h && by+18 > r.y); tries++) by += 20;
  turretLabelRects.push({x:bx, y:by, w, h:18});
  ctx.fillStyle='rgba(8,16,24,0.78)'; ctx.fillRect(bx, by, w, 18);
  ctx.fillStyle='#ffd27a'; ctx.fillText(label, lx, by+9);
  ctx.restore();
}

function drawShip(s, scale){
  const {x:dx, y:dy, heading:dh} = getDrawPos(s);
  const p = worldToScreen(dx, dy);
  const len = s.hullLen*scale, wid = s.hullWide*scale;
  let strokeColor = '#eafcff', lineW = 1;
  if(s.id===state.selectedShipId){ strokeColor = '#e8c15a'; lineW = 3; }
  else if(state.selectedShipIds.has(s.id)){ strokeColor = '#3fd0ff'; lineW = 2; }
  const mapSprite = MAP_SHIP_SPRITES[s.type];
  ctx.save();
  ctx.translate(p.x,p.y);
  if(mapSprite && !s.destroyed && mapSprite.img.complete){
    // Selection ring drawn first, unrotated, so it reads as a clean circle regardless of heading.
    if(s.id===state.selectedShipId || state.selectedShipIds.has(s.id)){
      ctx.beginPath();
      ctx.arc(0,0,Math.max(len,wid)*0.62,0,Math.PI*2);
      ctx.lineWidth = lineW;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
    }
    ctx.rotate((dh+MAP_SPRITE_BOW_OFFSET)*DEG2RAD);
    const frameIdx = Math.floor(mapSpriteClock*mapSprite.fps) % mapSprite.frameCount;
    // Scale by hull length (preserving the sprite's own aspect ratio) rather than stretching
    // to hullWide too — the art's own proportions read better than a forced non-uniform scale.
    const drawLen = len*(mapSprite.lenScale||1), drawWid = drawLen*(mapSprite.cellH/mapSprite.cellW);
    ctx.globalAlpha = (s.id===state.selectedShipId || state.selectedShipIds.has(s.id)) ? 1 : 0.9;
    ctx.drawImage(mapSprite.img, frameIdx*mapSprite.cellW, 0, mapSprite.cellW, mapSprite.cellH,
      -drawLen/2, -drawWid/2, drawLen, drawWid);
    ctx.globalAlpha = 1;
    // Destroyed this Firing phase: the explosion plays on top, its left edge at the stern and its right edge at the bow.
    if(s.sinkFx){
      const el = performance.now()-s.sinkFx.t0;
      if(el>=0 && el<SHIP_EXPLOSION.playMs*SHIP_EXPLOSION.plays && SHIP_EXPLOSION.img.complete){
        const fi = Math.min(SHIP_EXPLOSION.frameCount-1, Math.floor((el % SHIP_EXPLOSION.playMs)/SHIP_EXPLOSION.playMs*SHIP_EXPLOSION.frameCount));
        const eh = drawLen*(SHIP_EXPLOSION.cellH/SHIP_EXPLOSION.cellW);
        ctx.drawImage(SHIP_EXPLOSION.img, fi*SHIP_EXPLOSION.cellW, 0, SHIP_EXPLOSION.cellW, SHIP_EXPLOSION.cellH, -drawLen/2, -eh/2, drawLen, eh);
      }
    }
  } else {
    ctx.rotate(dh*DEG2RAD);
    // hull (pointy prow toward local -y after rotate since heading 0=north=-y on screen)
    ctx.beginPath();
    ctx.moveTo(0,-len/2);
    ctx.lineTo(wid/2, len/2*0.6);
    ctx.lineTo(wid/2*0.5, len/2);
    ctx.lineTo(-wid/2*0.5, len/2);
    ctx.lineTo(-wid/2, len/2*0.6);
    ctx.closePath();
    ctx.fillStyle = s.destroyed ? '#333' : shipColor(s);
    ctx.globalAlpha = (s.id===state.selectedShipId || state.selectedShipIds.has(s.id)) ? 1 : 0.9;
    ctx.fill();
    ctx.lineWidth = lineW;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
  }
  ctx.restore();
  // turret facing indicator (turret facing itself doesn't animate — only the hull's position does)
  if(s.turretWeapons.length>0 && !s.destroyed){
    const tf = getDrawTurretFacing(s), tp = worldToScreen(dx + 6*Math.sin(tf*DEG2RAD), dy - 6*Math.cos(tf*DEG2RAD));
    ctx.strokeStyle='#e8c15a'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(tp.x,tp.y); ctx.stroke();
  }
  if(s.isVip && !s.destroyed) btDrawVipMark(s, p, len, wid);
  // label
  ctx.fillStyle='#cfe9f7'; ctx.font='11px Segoe UI';
  ctx.fillText(shipLabel(s).slice(0,14), p.x+8, p.y-8);
  if(s.crit){   // critical damage marker
    ctx.fillStyle = '#ff9a6c'; ctx.font = 'bold 9px Segoe UI';
    ctx.fillText(s.crit.kind==='dead' ? 'DEAD IN WATER' : (s.crit.dir<0 ? 'HELM JAMMED L' : 'HELM JAMMED R'), p.x+8, p.y+3);
  }
  // mini health arcs (small ring segments)
  drawArcHealth(s, p, scale, dh);
}

function drawArcHealth(s,p,scale,heading){
  if(s.destroyed) return;
  if(heading==null) heading = s.heading;
  const R = s.hullLen*scale*0.55;
  const segs = [
    {arc:'prow', a0:-45,a1:45},
    {arc:'starboard', a0:45,a1:135},
    {arc:'stern', a0:135,a1:225},
    {arc:'port', a0:225,a1:315}
  ];
  segs.forEach(seg=>{
    const shieldPct = s.shieldsMax>0 ? s.shields[seg.arc]/ (seg.arc==='stern'?1:s.shieldsMax) : 0;
    const alive = s.armor[seg.arc] > 0;
    ctx.beginPath();
    ctx.strokeStyle = seg.arc==='stern' ? '#553' : (s.shields[seg.arc]>0 ? '#3fd0ff' : (alive?'#e8c15a':'#ff5566'));
    ctx.lineWidth = 3;
    ctx.arc(p.x,p.y,R, (heading+seg.a0-90)*DEG2RAD, (heading+seg.a1-90)*DEG2RAD);
    ctx.stroke();
  });
}

function drawRefloatRange(s, scale){
  const contact = s.grounded.contact;
  const p = worldToScreen(contact.x, contact.y);
  const r = 30*scale;
  ctx.save();
  ctx.setLineDash([5,4]);
  ctx.strokeStyle = 'rgba(232,193,90,0.7)';
  ctx.fillStyle = 'rgba(232,193,90,0.06)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x,p.y,r,0,7);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  // mark the original contact point itself
  ctx.beginPath();
  ctx.arc(p.x,p.y,4,0,7);
  ctx.fillStyle = 'rgba(232,193,90,0.9)';
  ctx.fill();
  ctx.restore();
  // rotation handle — grab and drag around the ship to set any heading at all
  const dp = getDrawPos(s);
  const shipP = worldToScreen(dp.x, dp.y);
  const handleWorld = refloatHandlePos(s);
  const hp = worldToScreen(handleWorld.x, handleWorld.y);
  ctx.save();
  ctx.strokeStyle = 'rgba(232,193,90,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(shipP.x, shipP.y);
  ctx.lineTo(hp.x, hp.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hp.x, hp.y, 7, 0, 7);
  ctx.fillStyle = state.refloatRotateDrag ? '#ffe08a' : 'rgba(232,193,90,0.9)';
  ctx.fill();
  ctx.strokeStyle = '#1a0a05'; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}


// Boxy translucent arrows for crippled ships: BLUE shows the way a dead-in-the-water ship is drifting (straight
// ahead on its momentum); ORANGE shows the way a helm-jammed ship is stuck going (the forced turn, to the side the
// wheel is locked). Both follow the path the ship will really take next Movement phase.
const CRIT_ARROW_MIN_LEN = 45;  // inches: shortest arrow drawn, so a ship that has almost stopped still shows its direction
function drawCritArrows(scale){
  allShips().forEach(s=>{
    if(!s.crit || s.destroyed || s.grounded) return;
    const dead = s.crit.kind==='dead';
    const plan = critMovementPlan(s, {speed:minSpeedFor(s), turns:[], minePlacedAtCum:null});
    plan.speed = Math.max(plan.speed, CRIT_ARROW_MIN_LEN);
    const path = computePath(s, plan);
    if(!path || !path.points || path.points.length<2) return;
    const pts = path.points.map(q=>worldToScreen(q.x,q.y));
    const last = path.points[path.points.length-1];
    const a = (last.heading!=null ? last.heading : path.endHeading)*DEG2RAD;
    const w = Math.max(9, 3.2*scale);          // shaft width
    const headW = w*2.2, headL = w*1.5;
    const fill = dead ? 'rgba(70,150,255,0.40)' : 'rgba(255,150,40,0.45)';
    const edge = dead ? 'rgba(130,190,255,0.85)' : 'rgba(255,190,100,0.9)';
    ctx.save();
    ctx.fillStyle = fill; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
    const tip = pts[pts.length-1];
    const fx = Math.sin(a), fy = -Math.cos(a);      // forward unit vector on screen
    const rx = -fy, ry = fx;                         // right-hand unit vector on screen
    const shaftEnd = {x: tip.x - fx*headL, y: tip.y - fy*headL};
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for(let i=1;i<pts.length-1;i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(shaftEnd.x, shaftEnd.y);
    ctx.lineWidth = w; ctx.strokeStyle = fill; ctx.stroke();
    // stepped, blocky arrowhead: a wide block then a narrower block ahead of it
    const box = (cx, cy, halfW, len)=>{
      ctx.beginPath();
      ctx.moveTo(cx - rx*halfW, cy - ry*halfW);
      ctx.lineTo(cx + rx*halfW, cy + ry*halfW);
      ctx.lineTo(cx + rx*halfW + fx*len, cy + ry*halfW + fy*len);
      ctx.lineTo(cx - rx*halfW + fx*len, cy - ry*halfW + fy*len);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = edge; ctx.stroke();
    };
    box(shaftEnd.x, shaftEnd.y, headW/2, headL*0.5);
    box(shaftEnd.x + fx*headL*0.5, shaftEnd.y + fy*headL*0.5, headW/4, headL*0.5);
    ctx.restore();
  });
}
function drawReachFan(s, scale){
  // MSMD (Minimum Ship Movement Distance) = 45% of last movement phase's distance (or the ship's
  // fixed stat on its first move). Illustrated literally: a straight line out from the bow for
  // that distance, then the blue turning arc pivoting from the point where that line ends.
  const msmd = s.lastDistance!=null ? 0.45*s.lastDistance : s.minTurnDist;
  const maxDist = s.movement;
  const straightDist = Math.min(msmd, maxDist);
  const turnDist = Math.max(0, maxDist - straightDist);
  // Movement is now set by a single click-and-drag, which produces at most one course
  // correction — so the achievable swing is the ship's turning stat, not stacked across turns.
  const maxSwing = s.turning;

  const fRad = s.heading*DEG2RAD;
  const fx = Math.sin(fRad), fy = -Math.cos(fRad); // unit "forward" vector, world space

  const bowP = worldToScreen(s.x, s.y);
  const pivotWorld = {x: s.x + fx*straightDist, y: s.y + fy*straightDist};
  const pivotP = worldToScreen(pivotWorld.x, pivotWorld.y);

  ctx.save();
  // The MSMD line itself — the ship must hold its heading through this stretch.
  ctx.beginPath();
  ctx.moveTo(bowP.x, bowP.y);
  ctx.lineTo(pivotP.x, pivotP.y);
  ctx.setLineDash([3,3]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(63,208,255,0.7)';
  ctx.stroke();
  ctx.setLineDash([]);
  // The turning arc, pivoting from the far end of the MSMD line.
  if(turnDist>0.05){
    const arcR = turnDist*scale;
    const a0 = (s.heading - maxSwing - 90)*DEG2RAD;
    const a1 = (s.heading + maxSwing - 90)*DEG2RAD;
    ctx.beginPath();
    ctx.moveTo(pivotP.x, pivotP.y);
    ctx.arc(pivotP.x, pivotP.y, arcR, a0, a1);
    ctx.closePath();
    ctx.fillStyle='rgba(63,208,255,0.08)';
    ctx.strokeStyle='rgba(63,208,255,0.35)';
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function computePath(s, plan){
  // plan: {speed, turns:[{deg}]} ; deg positive = turn to starboard(right), negative = port(left)
  // returns polyline points in inches, plus final heading & final position, and per-point cumulative distance
  let x=s.x, y=s.y, heading=s.heading;
  let pts=[{x,y,heading,cum:0}];
  let remaining = plan.speed;
  let sinceTurn = 0;
  let turnsLeft = plan.turns.slice();
  // move in small steps, applying turns once min distance satisfied, using turn cost model
  let turnIdx = 0;
  let dist_ = remaining;
  let cum=0;
  const stepSize = 1; // inch per simulation step for smoothness
  let pendingTurn = turnIdx < turnsLeft.length ? turnsLeft[turnIdx] : null;
  // MSMD — Minimum Ship Movement Distance: a ship must travel this far dead ahead before it can
  // begin a turn, equal to 45% of the distance it actually moved last movement phase. On a ship's
  // very first move there's no previous phase to measure, so fall back to its fixed Minimum
  // Distance Between Turning stat (Destroyer 8", Frigate 4") instead of allowing 0.
  // A jammed steering gear can't hold a straight line: the (forced) turn starts at once.
  const turnOnsetDist = (s.crit && s.crit.kind==='steering') ? 0 : (s.lastDistance!=null ? 0.45*s.lastDistance : s.minTurnDist);
  let islandHit = null;
  while(cum < dist_ - 1e-6){
    let step = Math.min(stepSize, dist_-cum);
    x += step*Math.sin(heading*DEG2RAD);
    y -= step*Math.cos(heading*DEG2RAD);
    cum += step; sinceTurn += step;
    pts.push({x,y,heading,cum});
    const hitIsland = islandAt(x,y);
    if(hitIsland){ islandHit = hitIsland; break; } // ship runs aground — stops dead, right here
    if(pendingTurn && sinceTurn >= turnOnsetDist){
      // apply turn cost: consumes extra distance from budget proportional to |deg|/turning stat
      const turnCost = s.minTurnDist * (Math.abs(pendingTurn.deg)/Math.max(1,s.turning));
      dist_ = Math.max(cum, dist_ - turnCost);
      heading = normDeg(heading + pendingTurn.deg);
      sinceTurn = 0;
      turnIdx++;
      pendingTurn = turnIdx < turnsLeft.length ? turnsLeft[turnIdx] : null;
      pts.push({x,y,heading,cum});
    }
  }
  return {points:pts, endX:x, endY:y, endHeading:heading, totalDist:cum, turnOnsetDist, islandHit};
}

// Rule 4c — momentum: next phase's minimum speed is 50% of what was actually travelled this phase,
// and next phase's maximum speed grows by 25% of what was actually travelled this phase.
function applyMomentum(s, actualDist){
  // Rule: a ship's top speed can never exceed 300% of its type's base Movement stat.
  s.momPrev = {movement:s.movement, distanceMoved:s.distanceMoved||0};
  s.movement = Math.min(s.baseMovement*s.topSpeedMult, s.movement + 0.25*actualDist);
  s.lastDistance = actualDist;
  s.distanceMoved = (s.distanceMoved||0) + actualDist;
}
function minSpeedFor(s){
  return s.lastDistance!=null ? 0.5*s.lastDistance : 0;
}

/* ============================== CRITICAL DAMAGE ============================== */
function rollDie(sides){ return 1 + Math.floor(Math.random()*sides); }
// Percentage of the ship's total armor (all four facings together) that is still intact.
function shipArmorPct(s){
  const max = SHIP_TYPES[s.type].armor; let cur = 0, tot = 0;
  ARCS.forEach(a=>{ cur += s.armor[a]; tot += max[a]; });
  return tot ? 100*cur/tot : 0;
}
// The D20 result a structure hit needs to count as a Critical Damage Hit, for a given armor percentage.
function critNeedsForArmorPct(pct){
  for(const t of CRIT_THRESHOLDS){ if(pct >= t.minPct - 1e-9) return t.needs; }
  return CRIT_BELOW_LOWEST_NEEDS;
}
// What a ship's Movement-phase orders really are once critical damage is taken into account:
//  - DEAD IN THE WATER: it can't be given movement or turning commands. It just coasts straight ahead at
//    the minimum speed its momentum allows.
//  - STEERING JAMMED: it can't turn freely. The speed is still the player's (within momentum), but the turn
//    is forced: full lock toward whichever side the wheel is stuck, starting at once (the usual minimum
//    distance before a turn does not apply — see computePath).
function critMovementPlan(s, plan){
  // FULL REVERSE STOP: no movement orders and no turns; the ship just coasts forward 25% of the distance it last moved.
  if(s.activeOrder==='reverse') return {speed:0.25*(s.lastDistance||0), turns:[], minePlacedAtCum:null};
  if(!s.crit) return plan;
  const minSpd = minSpeedFor(s);
  if(s.crit.kind==='dead') return {speed:minSpd, turns:[], minePlacedAtCum:null};
  const spd = Math.max(minSpd, Math.min(s.movement, plan.speed));
  return {speed:spd, turns:[{deg: s.crit.dir*s.turning}], minePlacedAtCum:null};
}
function defaultMoveDraft(s){
  return critMovementPlan(s, {speed:minSpeedFor(s), turns:[], minePlacedAtCum:null});
}
// Records one weapon hit that got through to Structure; its D20 is rolled with all the others at the
// end of the Firing phase (resolveCriticalDamage). Armor % is taken as it stands right after the hit.
function recordStructureHit(target, weaponKey){
  pendingCrits.push({shipId: target.id, pct: shipArmorPct(target), weaponKey});
}
// A ship already crippled that is crippled again keeps the worse of the two conditions, and its clock restarts.
function applyCritical(s, kind, dir){
  const rank = {steering:1, dead:2};
  const old = s.crit;
  if(old && rank[old.kind] > rank[kind]){ kind = old.kind; dir = old.dir; }
  else if(old && old.kind==='steering' && kind==='steering'){ dir = old.dir; }  // the wheel is already stuck that way
  s.crit = {kind, dir, fresh:true, repairRolls:0};
}
// Dead in the water: broadside guns still fire, but the turret is frozen (no aiming, no turret fire), the ship can't
// steer or move under its own power, and it can issue no Special Orders. All of it returns the moment the engines are repaired.
function deadWater(s){ return !!(s && s.crit && s.crit.kind==='dead'); }
function critDescribe(s){
  if(!s.crit) return '';
  return s.crit.kind==='dead' ? 'dead in the water' : 'steering jammed to '+(s.crit.dir<0?'port (left)':'starboard (right)');
}
// All the Critical Damage checks for the round, rolled together at the end of the Firing phase.
//  - one D20 per structure hit: needs the target number for the ship's armor level
//  - each Critical Damage Hit rolls a D6: 1 = catastrophic explosion (ship destroyed); 2-5 = dead in the water;
//    6 = steering jammed, and a D2 decides which way (1 = left, 2 = right)
//  - if one ship takes several Critical Damage Hits at once, the lowest D6 is the one that counts
function resolveCriticalDamage(){
  if(!pendingCrits.length) return;
  const events = pendingCrits; pendingCrits = [];
  const byShip = new Map();
  events.forEach(e=>{ if(!byShip.has(e.shipId)) byShip.set(e.shipId, []); byShip.get(e.shipId).push(e); });
  const live = [...byShip.keys()].filter(id=>{ const sh = shipById(id); return sh && !sh.destroyed && sh.structureCur>0; });
  if(!live.length) return;
  logMsg('sys', 'Critical damage checks (end of the Firing phase):');
  live.forEach(id=>{
    const s = shipById(id);
    const d6s = [];
    const lines = [];   // for the pop-up: every structure hit this ship took, with its rolls
    byShip.get(id).forEach(e=>{
      const needs = critNeedsForArmorPct(e.pct);
      const need = needs>1 ? needs+'+' : 'any roll';
      const d20 = rollDie(20);
      const pct = Math.round(e.pct);
      if(d20 < needs){
        lines.push({pct, needs, d20, crit:false, d6:null});
        logMsg('sys', `  ${shipLabel(s)}: structure hit, armor ${pct}% — D20 ${d20} (needs ${need}): no critical damage.`);
        return;
      }
      const d6 = rollDie(6); d6s.push(d6);
      lines.push({pct, needs, d20, crit:true, d6});
      logMsg('dmg', `  ${shipLabel(s)}: structure hit, armor ${pct}% — D20 ${d20} (needs ${need}): CRITICAL DAMAGE HIT! D6 = ${d6}.`);
    });
    if(!d6s.length) return;
    const worst = Math.min(...d6s);
    if(worst===1){
      s.structureCur = 0;
      spawnEffect('explosion', s.x, s.y);
      logMsg('dmg', `  ${shipLabel(s)} suffers a CATASTROPHIC EXPLOSION and is destroyed!`);
      showCritPopup(s, {kind:'explosion', lines});
    } else if(worst<=5){
      applyCritical(s, 'dead', 0);
      logMsg('dmg', `  ${shipLabel(s)} is DEAD IN THE WATER: no movement or turning orders in its next Movement phase.`);
      showCritPopup(s, {kind:'dead', lines});
    } else {
      const d2 = rollDie(2);
      applyCritical(s, 'steering', d2===1 ? -1 : +1);
      logMsg('dmg', s.crit.kind==='dead'
        ? `  ${shipLabel(s)}'s steering is jammed too, but it stays dead in the water.`
        : `  ${shipLabel(s)}'s STEERING IS JAMMED (D2 = ${d2}): stuck turning ${s.crit.dir<0?'left':'right'}.`);
      showCritPopup(s, s.crit.kind==='dead'
        ? {kind:'dead', lines, d2, note:'(Its steering is jammed as well, but being dead in the water is the worse of the two, so that is what counts.)'}
        : {kind:'steering', lines, d2});
    }
  });
}
// Start of every Movement phase: a crippled ship's first full phase is just served (no roll). From the phase
// after that, a D2 is rolled at the start of each Movement phase until it is repaired (a 2 repairs it).
function advanceCriticalState(s){
  if(!s.crit || s.destroyed) return;
  if(s.crit.fresh){ s.crit.fresh = false; return; }
  const d2 = rollDie(2);
  if(d2===2){
    logMsg('sys', `${shipLabel(s)}'s crew gets the ${s.crit.kind==='dead'?'engines':'steering'} working again (repair roll D2 = 2). Back to normal.`);
    s.crit = null;
  } else {
    s.crit.repairRolls++;
    logMsg('sys', `${shipLabel(s)}'s repairs fail (repair roll D2 = 1): still ${critDescribe(s)}.`);
  }
}

// Translates a click-and-drag on the map into a {speed, turns} plan: drag distance sets speed
// (clamped to this turn's momentum min/max), drag direction sets a single course-correction
// turn toward the drop point (clamped to the ship's max turn-per-action). The actual resulting
// path — which must still travel its MSMD straight before that turn can begin — is whatever
// computePath resolves; the live ghost preview shows the real result as the player drags.
function computeDragPlan(s, targetX, targetY){
  const minSpd = minSpeedFor(s);
  const maxSpd = s.movement;
  const rawDist = dist(s.x, s.y, targetX, targetY);
  const speed = Math.round(Math.max(minSpd, Math.min(maxSpd, rawDist)));
  const bearing = bearingFromTo(s.x, s.y, targetX, targetY);
  let turnNeeded = angDiff(bearing, s.heading);
  turnNeeded = Math.max(-s.turning, Math.min(s.turning, turnNeeded));
  const turns = Math.abs(turnNeeded) > 1 ? [{deg: Math.round(turnNeeded)}] : [];
  return critMovementPlan(s, { speed, turns, minePlacedAtCum: null }); // (a jammed ship's turn is forced whatever you drag)
}

function drawMoveDraftGhost(){
  const s = shipById(state.selectedShipId);
  if(!s || !state.moveDraft) return;
  const path = computePath(s, state.moveDraft);
  const onset = path.turnOnsetDist;
  ctx.save();
  ctx.lineWidth=1.5;
  ctx.setLineDash([4,3]);
  // Segment the ship must hold heading through — it can't begin turning before this many inches.
  if(onset>0){
    ctx.beginPath();
    let started=false;
    path.points.forEach(pt=>{
      if(pt.cum <= onset + 1e-6){
        const p = worldToScreen(pt.x,pt.y);
        if(!started){ ctx.moveTo(p.x,p.y); started=true; } else { ctx.lineTo(p.x,p.y); }
      }
    });
    ctx.strokeStyle='rgba(255,140,90,0.9)'; // orange = can't turn yet
    ctx.stroke();
  }
  // Segment from the turn-onset point onward — turning is allowed here.
  ctx.beginPath();
  let started2=false;
  path.points.forEach(pt=>{
    if(pt.cum >= onset - 1e-6){
      const p = worldToScreen(pt.x,pt.y);
      if(!started2){ ctx.moveTo(p.x,p.y); started2=true; } else { ctx.lineTo(p.x,p.y); }
    }
  });
  ctx.strokeStyle='rgba(255,255,255,0.6)';
  ctx.stroke();
  ctx.setLineDash([]);
  // Marker at the exact onset point, if it falls within this move.
  if(onset>0 && onset < path.totalDist - 1e-6){
    const pt = path.points.reduce((best,p)=> Math.abs(p.cum-onset) < Math.abs(best.cum-onset)?p:best, path.points[0]);
    const mp = worldToScreen(pt.x,pt.y);
    ctx.beginPath();
    ctx.arc(mp.x,mp.y,4,0,7);
    ctx.fillStyle='#ff8c5a';
    ctx.fill();
    ctx.strokeStyle='#1a0a05'; ctx.lineWidth=1; ctx.stroke();
  }
  // ghost hull outline at the planned end position — the actual hull shape, clearly outlined,
  // marking exactly where the ship will be dropped once this move is confirmed.
  const ep = worldToScreen(path.endX, path.endY);
  ctx.translate(ep.x,ep.y);
  ctx.rotate(path.endHeading*DEG2RAD);
  const scaleInfo = worldToScreen(0,0);
  const len = s.hullLen*scaleInfo.scale, wid=s.hullWide*scaleInfo.scale;
  ctx.beginPath();   // 4-sided diamond: bow, starboard, stern, port
  ctx.moveTo(0,-len/2);
  ctx.lineTo(wid/2, 0);
  ctx.lineTo(0, len/2);
  ctx.lineTo(-wid/2, 0);
  ctx.closePath();
  ctx.fillStyle='rgba(63,208,255,0.14)';
  ctx.strokeStyle='rgba(63,208,255,0.95)';
  ctx.lineWidth=2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // mine marker preview
  if(state.moveDraft.minePlacedAtCum!=null){
    const pt = path.points.reduce((best,p)=> Math.abs(p.cum-state.moveDraft.minePlacedAtCum) < Math.abs(best.cum-state.moveDraft.minePlacedAtCum)?p:best, path.points[0]);
    const mp = worldToScreen(pt.x,pt.y);
    ctx.fillStyle='#e8c15a';
    ctx.beginPath(); ctx.arc(mp.x,mp.y,5,0,7); ctx.fill();
  }
}

/* ============================== CANVAS SELECTION: click, shift-click, box-drag select ============================== */
function shipAtScreenPoint(mx, my){
  let best=null, bestD=1e9;
  allShips().forEach(s=>{
    const dp = getDrawPos(s);
    const p = worldToScreen(dp.x,dp.y);
    const d = Math.hypot(p.x-mx,p.y-my);
    if(d<18 && d<bestD){ best=s; bestD=d; }
  });
  return best;
}

function setActiveFromSelection(){
  // Pick which selected ship drives the right-hand panel.
  if(state.selectedShipIds.size===0){ state.selectedShipId=null; return; }
  if(!state.selectedShipId || !state.selectedShipIds.has(state.selectedShipId)){
    state.selectedShipId = [...state.selectedShipIds][0];
  }
}
function replaceSelection(ids){
  state.selectedShipIds = new Set(ids);
  setActiveFromSelection();
}
function toggleShipInSelection(id){
  if(state.selectedShipIds.has(id)){ state.selectedShipIds.delete(id); }
  else { state.selectedShipIds.add(id); state.selectedShipId = id; }
  setActiveFromSelection();
}
function pruneSelection(){
  // Drop any selected ship that's since been destroyed, then re-settle the active ship.
  [...state.selectedShipIds].forEach(id=>{
    const sh = shipById(id);
    if(!sh || sh.destroyed) state.selectedShipIds.delete(id);
  });
  setActiveFromSelection();
}

/* ============================== BREAKTHROUGH MODE ============================== */
// Attacker vs Defender. The attacker (with its VIPs) must reach the Exit Zone on the far short edge; the defender must stop
// them (sink the VIPs or run out the clock). Setup is a hidden, simultaneous drag-and-drop deployment on the real board.
const BT_ROUND_LIMIT = 20;
const BT_ATK_DEPTH = 200, BT_EXIT_LEN = 200, BT_EXIT_DEPTH = 100;
let btOpt = { role:'attacker', vipCount:1 };
const $id = (id)=>document.getElementById(id);
function btActive(){ return state.skirmishType==='breakthrough' && !!state.bt; }
function kothActive(){ return state.skirmishType==='koth' && !!state.bt && !!state.bt.koth; }
function btAttackerSide(){ return state.bt.playerRole==='attacker' ? 'player' : 'ai'; }
function btDefenderSide(){ return btAttackerSide()==='player' ? 'ai' : 'player'; }
function btRoleOf(s){ if(kothActive()) return 'defender'; return s.side===btAttackerSide() ? 'attacker' : 'defender'; }
function btInRect(r,x,y,eps){ eps = eps==null ? 0.01 : eps; return x>=r.x-eps && x<=r.x+r.w+eps && y>=r.y-eps && y<=r.y+r.h+eps; }
function btHullInRect(r,x,y,heading,len,wid){ return hullCorners(x,y,heading,len,wid).every(p=>btInRect(r,p.x,p.y)); }
function btRank(s){ return SHIP_ORDER.indexOf(s.type); }
function btShuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

// Random short edge for the attacker; the exit zone sits at a random spot on the opposite short edge; the defender's square lies halfway between.
function btMakeZones(){
  const west = Math.random()<0.5;
  const exitY0 = Math.floor(Math.random()*(BOARD_H-BT_EXIT_LEN+1));
  const atkRect = west ? {x:0,y:0,w:BT_ATK_DEPTH,h:BOARD_H} : {x:BOARD_W-BT_ATK_DEPTH,y:0,w:BT_ATK_DEPTH,h:BOARD_H};
  const exitRect = west ? {x:BOARD_W-BT_EXIT_DEPTH,y:exitY0,w:BT_EXIT_DEPTH,h:BT_EXIT_LEN} : {x:0,y:exitY0,w:BT_EXIT_DEPTH,h:BT_EXIT_LEN};
  const atkInner = west ? BT_ATK_DEPTH : BOARD_W-BT_ATK_DEPTH;
  const exitInner = west ? BOARD_W-BT_EXIT_DEPTH : BT_EXIT_DEPTH;
  const cx = (atkInner+exitInner)/2, cy = exitY0+BT_EXIT_LEN/2;
  const defRect = {x:cx-BT_EXIT_LEN/2, y:cy-BT_EXIT_LEN/2, w:BT_EXIT_LEN, h:BT_EXIT_LEN};
  return { atkEdge: west?'west':'east', exitEdge: west?'east':'west', atkRect, defRect, exitRect,
    gate:{ x: west?BOARD_W:0, y:cy, y0:exitY0, y1:exitY0+BT_EXIT_LEN },
    atkHeading: west?90:270, defHeading: west?270:90 };
}

/* ---------- VIP choice ---------- */
function btAutoVips(ships, n){
  n = Math.max(1, Math.min(n, ships.length));
  const top = Math.max(...ships.map(btRank));
  const first = btShuffle(ships.filter(s=>btRank(s)===top))[0];
  return [first, ...btShuffle(ships.filter(s=>s!==first)).slice(0,n-1)];
}
function btVipsValid(ships, picked, n){
  if(picked.length!==n) return false;
  if(n<=1) return true;
  const top = Math.max(...ships.map(btRank));
  return picked.some(s=>btRank(s)===top);
}
function btVipNeeded(n){ return Math.floor(n/2)+1; }   // "more than 50%" of the VIPs

function proceedToBtBriefing(){
  if(state.skirmishType==='koth'){ kothBriefingStart(); return; }
  $id('fitmentScreen').style.display='none';
  const total = state.fleets.player.length;
  const n = Math.max(1, Math.min(total, btOpt.vipCount));
  const zones = btMakeZones();
  state.bt = Object.assign(zones, { playerRole: btOpt.role, vipCount:n, ready:false });
  [...state.fleets.player, ...state.fleets.ai].forEach(s=>{ s.isVip=false; s.placed=false; s.extracted=false; s.depPreview=null; });
  const atkShips = state.fleets[btAttackerSide()];
  btAutoVips(atkShips, n).forEach(s=>{ s.isVip = true; });   // default: the heaviest ship, then random others (the player attacker can change this)
  btRenderBriefing();
  $id('btBriefModal').classList.add('show');
}
function btRenderBriefing(){
  if(state.bt && state.bt.koth){ kothRenderBriefing(); return; }
  const bt = state.bt, n = bt.vipCount;
  const atkShips = state.fleets[btAttackerSide()];
  const playerAtk = bt.playerRole==='attacker';
  const picked = atkShips.filter(s=>s.isVip);
  const valid = btVipsValid(atkShips, picked, n);
  const top = Math.max(...atkShips.map(btRank));
  let vipHTML;
  if(playerAtk){
    vipHTML = `<h3>Choose your ${n} VIP${n>1?'s':''}</h3>
      <p class="smallDim">${n>1 ? `With more than one VIP, at least one must be a ${SHIP_ORDER[top]} (your heaviest class).` : 'Any ship may be the VIP.'}
      Both admirals can see which ships are VIPs. Selected: <b style="color:${valid?'var(--good)':'var(--bad)'}">${picked.length} of ${n}</b></p>
      <div class="btVipList">${atkShips.map(s=>`<label class="btVipRow"><input type="checkbox" data-ship="${s.id}" ${s.isVip?'checked':''}>
        <span>${s.isVip?'★ ':''}${shipLabel(s)}</span><small>${s.type}</small></label>`).join('')}</div>
      <div class="row" style="justify-content:center;margin-top:6px;"><button id="btAutoVipBtn">Auto-pick</button></div>`;
  } else {
    vipHTML = `<h3>The enemy's VIPs</h3>
      <p class="smallDim">The attacking admiral has designated ${n} VIP${n>1?'s':''}. You can see them, and so can they.</p>
      <div class="btVipList">${picked.map(s=>`<div class="btVipRow"><span>★ ${shipLabel(s)}</span><small>${s.type}</small></div>`).join('')}</div>`;
  }
  const rules = playerAtk
    ? `Get your VIPs into the <b>Exit Zone</b> on the far side. More than half of them must make it out within ${BT_ROUND_LIMIT} rounds.`
    : `Stop the enemy VIPs from reaching the <b>Exit Zone</b>. Sink them, or run out the clock (${BT_ROUND_LIMIT} rounds).`;
  $id('btBriefBox').innerHTML = `<h1>Breakthrough — Mission Briefing</h1>
    <p>You are the <b style="color:var(--gold)">${playerAtk?'Attacker':'Defender'}</b>. ${rules}</p>
    <ul>
      <li>The attackers deploy on the <b>${bt.atkEdge}</b> edge; the Exit Zone is on the <b>${bt.exitEdge}</b> edge. The defenders deploy in the square halfway between.</li>
      <li>A ship leaves the battle by ending a round fully inside the Exit Zone, or by sailing off the board through the Exit Zone's stretch of edge. Any attacking ship can do this, but only the VIPs count towards victory.</li>
      <li>An extracted ship is removed at the end of the Firing phase, so it can still be shot on the way out.</li>
      <li>If every defender is sunk, the defenders lose.</li>
    </ul>
    ${vipHTML}
    <div class="row" style="justify-content:center;margin-top:12px;gap:10px;">
      <button id="btBriefBackBtn">← Back</button>
      <button class="primary" id="btBriefGoBtn" ${valid?'':'disabled'}>Begin Deployment →</button>
    </div>`;
  $id('btBriefBackBtn').onclick = ()=>{ $id('btBriefModal').classList.remove('show'); $id('fitmentScreen').style.display='flex'; renderFitmentScreen(); };
  $id('btBriefGoBtn').onclick = ()=>{ $id('btBriefModal').classList.remove('show'); btStartDeployment(); };
  if(playerAtk){
    $id('btBriefBox').querySelectorAll('input[data-ship]').forEach(cb=>{
      cb.onchange = ()=>{ const sh = shipById(cb.dataset.ship); sh.isVip = cb.checked; btRenderBriefing(); };
    });
    $id('btAutoVipBtn').onclick = ()=>{ atkShips.forEach(s=>s.isVip=false); btAutoVips(atkShips, n).forEach(s=>s.isVip=true); btRenderBriefing(); };
  }
}

/* ---------- Islands ---------- */
// Islands stay out of every deployment zone and the Exit Zone, and always leave at least one clear lane across the board.
function btLaneClear(islands, axis){
  const ax = axis==='x' ? 'x' : 'y', LIM = ax==='x' ? BOARD_W : BOARD_H;
  const iv = islands.map(isl=>{
    let y0=Infinity,y1=-Infinity;
    isl.points.forEach(p=>{ y0=Math.min(y0,p[ax]); y1=Math.max(y1,p[ax]); });
    return [y0-24, y1+24];
  }).sort((a,b)=>a[0]-b[0]);
  let covered = 0;   // everything from 0 to `covered` is blocked
  for(const [a,b] of iv){
    if(a > covered + 2) return true;
    covered = Math.max(covered, b);
  }
  return covered < LIM - 2;
}
function btGenerateIslands(){
  const bt = state.bt;
  const rects = bt.koth ? [bt.pRect, bt.aRect, kothHillBox()] : [bt.atkRect, bt.defRect, bt.exitRect];
  for(let tries=0; tries<40; tries++){
    const isl = generateIslands({ ignoreShips:true, avoidRects:rects });
    if(btLaneClear(isl, bt.koth && bt.orient==='ns' ? 'x' : 'y')) return isl;
  }
  return [];
}

/* ---------- Placement rules ---------- */
function btZoneFor(s){ if(state.bt.koth) return s.side==='player' ? state.bt.pRect : state.bt.aRect; return btRoleOf(s)==='attacker' ? state.bt.atkRect : state.bt.defRect; }
// Returns null when (x,y,heading) is a legal spot for s, otherwise a short reason.
function btPlacementCheck(s, x, y, heading){
  const bt = state.bt, zone = btZoneFor(s);
  if(!btHullInRect(zone, x, y, heading, s.hullLen, s.hullWide)) return 'Ships must sit fully inside your own deployment zone.';
  const C = hullCorners(x, y, heading, s.hullLen, s.hullWide);
  if(bt.exitRect && (btHullInRect(bt.exitRect, x, y, heading, s.hullLen, s.hullWide) || C.some(p=>btInRect(bt.exitRect,p.x,p.y)))) return 'The Exit Zone is off limits during deployment.';
  for(const isl of state.islands){ if(islandAt(x,y) || polygonsOverlap(C, isl.points) || C.some(p=>pointInPolygon(p.x,p.y,isl.points))) return 'That spot is on an island.'; }
  const mine = hullCorners(x, y, heading, s.hullLen+2, s.hullWide+2);
  for(const o of state.fleets[s.side]){
    if(o===s || !o.placed) continue;
    if(hullsOverlap(mine, hullCorners(o.x,o.y,o.heading,o.hullLen+2,o.hullWide+2))) return 'That overlaps another ship.';
  }
  return null;
}
function btDefaultHeading(s){ if(state.bt.koth) return s.side==='player' ? state.bt.pHeading : state.bt.aHeading; return btRoleOf(s)==='attacker' ? state.bt.atkHeading : state.bt.defHeading; }
function btAutoPlace(ships){
  const bt = state.bt;
  const todo = ships.filter(s=>!s.placed).sort((a,b)=>btRank(b)-btRank(a));
  todo.forEach(s=>{
    const zone = btZoneFor(s), role = btRoleOf(s);
    const h = btDefaultHeading(s);
    const rad = Math.max(s.hullLen, s.hullWide)/2 + 2;
    const pick = (u,v)=>{ // u: 0..1 along the zone's width, v: 0..1 along its height
      return { x: zone.x + rad + u*(zone.w-2*rad), y: zone.y + rad + v*(zone.h-2*rad) };
    };
    // 'depth' = distance from the ship's own board edge; attackers keep VIPs towards the rear, escorts out in front
    const fromEdge = (f)=> bt.atkEdge==='west' ? f : 1-f;
    let ok = false;
    for(let t=0; t<500 && !ok; t++){
      let u;
      if(role==='attacker'){ const f = s.isVip ? Math.random()*0.5 : 0.35+Math.random()*0.65; u = fromEdge(f); }
      else u = Math.random();
      const p = pick(u, Math.random());
      if(!btPlacementCheck(s, p.x, p.y, h)){ s.x=p.x; s.y=p.y; ok=true; }
    }
    if(!ok){   // crowded: scan the zone for any legal gap
      for(let yy=zone.y+rad; yy<=zone.y+zone.h-rad && !ok; yy+=4){
        for(let xx=zone.x+rad; xx<=zone.x+zone.w-rad && !ok; xx+=4){
          if(!btPlacementCheck(s, xx, yy, h)){ s.x=xx; s.y=yy; ok=true; }
        }
      }
    }
    if(ok){ s.heading=h; s.placed=true; s.turretFacing=h; s.turretSyncHeading=h; }
  });
}

/* ---------- Deployment screen ---------- */
function btStartDeployment(){
  const bt = state.bt;
  $id('mainMenuScreen').style.display='none';
  $id('titleScreen').style.display='none';
  $id('app').style.display='flex';
  state.sunDeg = Math.floor(Math.random()*360);
  $id('sunBearing').textContent = state.sunDeg;
  assignAiNames();
  state.phase = 'deploy'; state.activeSide = 'player'; state.round = 1;
  state.selectedShipIds.clear(); state.selectedShipId = null;
  state.zoom = 1; state.viewCenter = { x:BOARD_W/2, y:BOARD_H/2 };
  $id('roundNo').textContent = '1';
  [...state.fleets.player, ...state.fleets.ai].forEach(s=>{ s.placed=false; s.heading=btDefaultHeading(s); s.depPreview=null; });
  state.islands = btGenerateIslands();
  btAutoPlace(state.fleets.ai);                 // the enemy deploys now, hidden until both sides are Ready
  battleMusic.currentTime = 0; battleMusic.play().catch(()=>{});
  resizeCanvas();
  state.viewCenter.x = BOARD_W/2 - 160/(fitScale()*state.zoom*PX);   // nudge the board clear of the tray
  logMsg('sys', bt.koth ? 'Deployment: drag your ships from the fleet list into your zone, then press Ready.' : `Deployment: you are the ${bt.playerRole}. Drag your ships from the fleet list onto the board, then press Ready.`);
  btRenderTray();
  updatePhaseBanner();
  startAnimLoop();
}
function btRenderTray(){
  const tray = $id('deployTray'), bt = state.bt;
  if(!tray || !bt) return;
  const ships = state.fleets.player;
  const nPlaced = ships.filter(s=>s.placed).length;
  const playerAtk = bt.playerRole==='attacker';
  const keepMsg = $id('dtMsg') ? $id('dtMsg').textContent : '';
  const rows = ships.map(s=>{
    const sel = s.id===state.selectedShipId;
    let extra = '';
    if(sel){
      extra = `<div class="dtExtra">${s.placed ? `<div class="row" style="gap:6px;margin-bottom:6px;align-items:center;">
          <span class="smallDim">Heading ${Math.round(s.heading)}°</span>
          <button class="dtRot" data-d="-15">⟲ 15°</button><button class="dtRot" data-d="15">⟳ 15°</button></div>`
        : '<div class="smallDim" style="margin-bottom:6px;">Drag this ship onto the board.</div>'}
        ${arcTogglesHTML(s)}</div>`;
    }
    return `<div class="dtRow${s.placed?' placed':''}${sel?' sel':''}" data-ship="${s.id}">
        <span class="dtGrip">⠿</span>
        <span class="dtName">${s.isVip?'<span class="dtStar">★</span> ':''}${shipLabel(s)} <small>${s.type}</small></span>
        <span class="dtState">${s.placed?'✓':'drag →'}</span>
        ${s.placed?`<button class="dtRemove" data-ship="${s.id}" title="Take back off the board">✕</button>`:''}
      </div>${extra}`;
  }).join('');
  tray.innerHTML = `<div class="dtHead">DEPLOYMENT <span class="dtRole">${bt.koth?'KING OF THE HILL':(playerAtk?'ATTACKER':'DEFENDER')}</span></div>
    <div class="dtHint">${bt.koth
      ? `Deploy inside the <b style="color:#5cb8ff">blue</b> band on the ${bt.pEdge} edge. Then fight for the <b style="color:#ffd84a">Hill</b> in the centre of the board.`
      : playerAtk
      ? `Deploy inside the <b style="color:#ff9a5c">orange</b> band on the ${bt.atkEdge} edge. ★ marks your VIPs. Reach the <b style="color:#4be08a">green</b> Exit Zone.`
      : `Deploy inside the <b style="color:#5cb8ff">blue</b> square. Stop the ★ VIPs reaching the <b style="color:#4be08a">green</b> Exit Zone.`}
      The enemy's ships stay hidden until both sides are Ready.</div>
    <div class="dtCount"><b>${nPlaced} of ${ships.length}</b> placed</div>
    <div class="row" style="gap:6px;margin:6px 0;"><button id="dtAuto" style="flex:1;">Auto-place</button><button id="dtReset" style="flex:1;">Reset</button></div>
    <div class="dtList">${rows}</div>
    <div id="dtMsg" class="dtMsg">${keepMsg}</div>
    <div class="row" style="gap:6px;margin-top:8px;"><button id="dtBack">← Back</button>
      <button class="primary" id="dtReady" style="flex:1;" ${nPlaced<ships.length?'disabled':''}>Ready</button></div>`;
  tray.classList.add('show');
  tray.querySelectorAll('.dtRow').forEach(r=>{
    r.addEventListener('mousedown', (e)=>{
      if(e.button!==0 || e.target.closest('button')) return;
      e.preventDefault();
      const s = shipById(r.dataset.ship);
      btSelect(s.id);
      btStartDrag(s, 'move', e, null);
    });
  });
  tray.querySelectorAll('.dtRemove').forEach(b=>{ b.onclick = ()=>{ const s=shipById(b.dataset.ship); s.placed=false; btMsg(''); btRenderTray(); }; });
  tray.querySelectorAll('.dtRot').forEach(b=>{ b.onclick = ()=>{
    const s = shipById(state.selectedShipId); if(!s || !s.placed) return;
    const h = normDeg(s.heading + parseFloat(b.dataset.d));
    const why = btPlacementCheck(s, s.x, s.y, h);
    if(why){ btMsg(why); return; }
    s.heading = h; s.turretFacing = h; s.turretSyncHeading = h; btMsg(''); btRenderTray();
  }; });
  tray.querySelectorAll('.arcToggleBtn').forEach(b=>{
    b.onclick = ()=>{
      const s = shipById(state.selectedShipId); if(!s) return;
      s.arcShow = s.arcShow || {}; s.arcShow[b.dataset.arc] = !s.arcShow[b.dataset.arc];
      btRenderTray();
    };
  });
  $id('dtAuto').onclick = ()=>{ btAutoPlace(ships); btMsg(ships.every(s=>s.placed) ? '' : 'Some ships would not fit — place the rest by hand.'); btRenderTray(); };
  $id('dtReset').onclick = ()=>{ ships.forEach(s=>{ s.placed=false; s.heading=btDefaultHeading(s); }); btMsg(''); btRenderTray(); };
  $id('dtReady').onclick = btReady;
  $id('dtBack').onclick = ()=>{
    if(!confirm('Go back to the briefing? Your placements will be cleared.')) return;
    $id('deployTray').classList.remove('show');
    $id('app').style.display='none';
    state.phase='movement'; state.islands=[];
    ships.forEach(s=>{ s.placed=false; });
    btRenderBriefing(); $id('btBriefModal').classList.add('show');
  };
}
function btMsg(t){ const m=$id('dtMsg'); if(m) m.textContent = t||''; }
function btSelect(id){
  state.selectedShipIds = new Set(id?[id]:[]); state.selectedShipId = id || null;
}

/* ---------- Dragging on the board ---------- */
state.deployDrag = null;
function btCanvasPos(e){
  const r = canvas.getBoundingClientRect();
  return { mx:e.clientX-r.left, my:e.clientY-r.top, inside: e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom };
}
function btStartDrag(s, mode, e, grab){
  state.deployDrag = { ship:s, mode, grab: grab||{dx:0,dy:0} };
  btUpdateDragPreview(e);
}
function btUpdateDragPreview(e){
  const d = state.deployDrag; if(!d) return;
  const s = d.ship, {mx,my,inside} = btCanvasPos(e);
  if(!inside){ s.depPreview = null; return; }
  const w = screenToWorld(mx,my);
  let x, y, h;
  if(d.mode==='move'){ x = w.x + d.grab.dx; y = w.y + d.grab.dy; h = s.heading; }
  else { x = s.x; y = s.y; h = normDeg(Math.round(bearingFromTo(s.x,s.y,w.x,w.y))); }
  const why = btPlacementCheck(s, x, y, h);
  s.depPreview = { x, y, heading:h, legal:!why, reason:why };
}
window.addEventListener('mousemove', (e)=>{ if(state.deployDrag && state.phase==='deploy') btUpdateDragPreview(e); });
window.addEventListener('mouseup', ()=>{
  const d = state.deployDrag; if(!d) return;
  state.deployDrag = null;
  const s = d.ship, pv = s.depPreview;
  s.depPreview = null;
  if(state.phase!=='deploy') return;
  if(pv && pv.legal){
    s.x=pv.x; s.y=pv.y; s.heading=pv.heading; s.turretFacing=s.heading; s.turretSyncHeading=s.heading; s.placed=true; btMsg('');
  } else if(pv){ btMsg(pv.reason); }
  btRenderTray();
});
function btRotateHandlePos(s){
  const rad = s.heading*DEG2RAD, d = s.hullLen/2 + 14;
  return { x: s.x + Math.sin(rad)*d, y: s.y - Math.cos(rad)*d };
}
function btShipAtPoint(mx,my){
  const w = screenToWorld(mx,my);
  let best = null, bestD = Infinity;
  state.fleets.player.forEach(s=>{
    if(!s.placed) return;
    const r = s.heading*DEG2RAD, fx = Math.sin(r), fy = -Math.cos(r), sx = Math.cos(r), sy = Math.sin(r);
    const dx = w.x-s.x, dy = w.y-s.y;
    const f = Math.abs(dx*fx+dy*fy), sd = Math.abs(dx*sx+dy*sy);
    if(f <= s.hullLen/2+3 && sd <= Math.max(s.hullWide/2,4)+3){
      const dd = Math.hypot(dx,dy);
      if(dd<bestD){ bestD=dd; best=s; }
    }
  });
  return best;
}
// Registered before the normal board handlers, so during deployment it takes the left click for itself.
canvas.addEventListener('mousedown', (e)=>{
  if(state.phase!=='deploy' || e.button!==0) return;
  e.stopImmediatePropagation();
  const {mx,my} = btCanvasPos(e);
  const sel = state.selectedShipId ? shipById(state.selectedShipId) : null;
  if(sel && sel.side==='player' && sel.placed){
    const hw = btRotateHandlePos(sel), hp = worldToScreen(hw.x, hw.y);
    if(Math.hypot(hp.x-mx, hp.y-my) < 14){ btStartDrag(sel, 'rotate', e, null); return; }
  }
  const hit = btShipAtPoint(mx,my);
  if(hit){
    const w = screenToWorld(mx,my);
    btSelect(hit.id);
    btStartDrag(hit, 'move', e, { dx:hit.x-w.x, dy:hit.y-w.y });
    btRenderTray();
    return;
  }
  btSelect(null); btRenderTray();
});

/* ---------- Drawing ---------- */
function btDrawZones(scale){
  const bt = state.bt; if(!bt) return;
  if(bt.koth){ kothDrawZones(scale); return; }
  const deploying = state.phase==='deploy';
  const box = (r, fill, stroke, label, opts)=>{
    opts = opts || {};
    const a = worldToScreen(r.x, r.y), b = worldToScreen(r.x+r.w, r.y+r.h);
    ctx.save();
    ctx.fillStyle = fill; ctx.fillRect(a.x, a.y, b.x-a.x, b.y-a.y);
    ctx.strokeStyle = stroke; ctx.lineWidth = opts.bold ? 3 : 1.5; ctx.setLineDash(opts.dash || [8,6]);
    ctx.strokeRect(a.x, a.y, b.x-a.x, b.y-a.y);
    ctx.setLineDash([]);
    ctx.fillStyle = stroke; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(label, (a.x+b.x)/2, (a.y+b.y)/2 - 2);
    if(opts.sub){ ctx.font = '10px Segoe UI'; ctx.fillText(opts.sub, (a.x+b.x)/2, (a.y+b.y)/2 + 12); }
    ctx.restore();
  };
  if(deploying){
    const mineAtk = bt.playerRole==='attacker';
    const pulse = state.deployDrag ? 0.22 : 0.13;
    box(bt.atkRect, `rgba(255,140,60,${mineAtk?pulse:0.07})`, '#ff9a5c', 'ATTACKER DEPLOYMENT', { bold:mineAtk, sub: mineAtk?'your zone':'' });
    box(bt.defRect, `rgba(70,160,255,${mineAtk?0.07:pulse})`, '#5cb8ff', 'DEFENDER DEPLOYMENT', { bold:!mineAtk, sub: mineAtk?'':'your zone' });
  }
  box(bt.exitRect, 'rgba(60,220,120,0.16)', '#4be08a', 'EXIT ZONE', { dash:[], bold:true });
  // the stretch of board edge that counts as the exit gate
  const g0 = worldToScreen(bt.gate.x, bt.gate.y0), g1 = worldToScreen(bt.gate.x, bt.gate.y1);
  ctx.save(); ctx.strokeStyle = '#4be08a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(g0.x,g0.y); ctx.lineTo(g1.x,g1.y); ctx.stroke(); ctx.restore();
}
function btDrawDeployOverlay(scale){
  if(state.phase!=='deploy') return;
  state.fleets.player.forEach(s=>{
    const pv = s.depPreview;
    if(pv){
      const C = hullCorners(pv.x, pv.y, pv.heading, s.hullLen, s.hullWide).map(p=>worldToScreen(p.x,p.y));
      ctx.save();
      ctx.beginPath(); C.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath();
      ctx.fillStyle = pv.legal ? 'rgba(80,230,140,0.35)' : 'rgba(255,70,70,0.45)';
      ctx.strokeStyle = pv.legal ? '#4be08a' : '#ff4646'; ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();
      if(!pv.legal){ const c = worldToScreen(pv.x,pv.y); ctx.fillStyle='#ff6b6b'; ctx.font='bold 12px Segoe UI'; ctx.textAlign='center'; ctx.fillText('✕', c.x, c.y-14); }
      ctx.restore();
    }
  });
  const sel = state.selectedShipId ? shipById(state.selectedShipId) : null;
  if(sel && sel.side==='player' && sel.placed){
    const base = worldToScreen(sel.depPreview ? sel.depPreview.x : sel.x, sel.depPreview ? sel.depPreview.y : sel.y);
    const hs = sel.depPreview ? sel.depPreview.heading : sel.heading;
    const tmp = { x:(sel.depPreview?sel.depPreview.x:sel.x), y:(sel.depPreview?sel.depPreview.y:sel.y), heading:hs, hullLen:sel.hullLen };
    const hw = btRotateHandlePos(tmp), hp = worldToScreen(hw.x, hw.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(232,193,90,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(hp.x, hp.y, 7, 0, 7);
    ctx.fillStyle = (state.deployDrag && state.deployDrag.mode==='rotate') ? '#ffe08a' : 'rgba(232,193,90,0.95)'; ctx.fill();
    ctx.strokeStyle = '#1a0a05'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
}
function btDrawVipMark(s, p, len, wid){
  const R = Math.max(len, wid)*0.75 + 3;
  ctx.save();
  ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
  ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffd84a'; ctx.font = 'bold 13px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('★', p.x, p.y - R - 3);
  ctx.restore();
}
function btUpdateHud(){
  const el = $id('btHud'); if(!el) return;
  const hint = $id('topHint'); if(hint) hint.style.display = (btActive()||kothActive()) ? 'none' : '';
  if(kothActive()){ kothUpdateHud(el); return; }
  if(!btActive()){ el.innerHTML = ''; return; }
  if(state.phase==='deploy'){ el.innerHTML = '<b>BREAKTHROUGH</b> · deployment'; return; }
  const vips = state.fleets[btAttackerSide()].filter(s=>s.isVip);
  const ex = vips.filter(v=>v.extracted).length, lost = vips.filter(v=>v.destroyed && !v.extracted).length;
  el.innerHTML = `<span style="color:#ffd84a">★ VIPs</span> <span style="color:var(--good)">${ex} out</span> · ${vips.length-ex-lost} afloat · <span style="color:var(--bad)">${lost} lost</span> · need ${btVipNeeded(vips.length)} · <b>R${Math.min(state.round,BT_ROUND_LIMIT)}/${BT_ROUND_LIMIT}</b>`;
}

/* ---------- Ready: reveal and fight ---------- */
function btReady(){
  const ships = state.fleets.player;
  if(!ships.every(s=>s.placed)) return;
  $id('deployTray').classList.remove('show');
  state.selectedShipIds.clear(); state.selectedShipId = null;
  [...state.fleets.player, ...state.fleets.ai].forEach(s=>{ s.turretFacing = s.heading; s.turretSyncHeading = s.heading; s.depPreview=null; });
  state.bt.ready = true;
  state.viewCenter = { x:BOARD_W/2, y:BOARD_H/2 };
  state.phase = 'movement'; state.activeSide = 'player';
  logMsg('sys', 'Both sides are Ready — the deployments are revealed. Battle is joined.');
  beginRound();
}

/* ---------- Extraction, win and loss ---------- */
function btExtractShip(s, how){
  s.extracted = true; s.destroyed = true;
  logMsg('hit', `${shipLabel(s)}${s.isVip?' (VIP)':''} ${how} and is extracted from the battle!`);
}
// Did this ship's path cross the board edge inside the exit gate?
function btExitsThroughGate(s, path){
  const bt = state.bt, east = bt.exitEdge==='east';
  const outside = (p)=> east ? p.x>BOARD_W : p.x<0;
  let cy = null;
  if(path && path.points && path.points.length>1){
    const pts = path.points;
    for(let i=1;i<pts.length;i++){
      if(outside(pts[i]) && !outside(pts[i-1])){
        const edgeX = east ? BOARD_W : 0;
        const t = (edgeX-pts[i-1].x)/(pts[i].x-pts[i-1].x);
        cy = pts[i-1].y + t*(pts[i].y-pts[i-1].y);
        break;
      }
      // left the board some other way first
      if((pts[i].x<0||pts[i].x>BOARD_W||pts[i].y<0||pts[i].y>BOARD_H) && !outside(pts[i])) return false;
    }
  } else if(outside({x:s.x,y:s.y})) cy = s.y;
  return cy!=null && cy>=bt.gate.y0 && cy<=bt.gate.y1;
}
// End of every Firing phase: attackers fully inside the Exit Zone (and still afloat) leave the battle.
function btExtractionCheck(){
  if(!btActive()) return;
  const bt = state.bt;
  state.fleets[btAttackerSide()].filter(s=>!s.destroyed && s.structureCur>0).forEach(s=>{
    if(btHullInRect(bt.exitRect, s.x, s.y, s.heading, s.hullLen, s.hullWide)) btExtractShip(s, 'ends the round in the Exit Zone');
  });
}
function btResult(){
  const atk = btAttackerSide(), def = btDefenderSide();
  const vips = state.fleets[atk].filter(s=>s.isVip);
  const ex = vips.filter(v=>v.extracted).length;
  return { atk, def, vips, ex, need:btVipNeeded(vips.length), attackerWins: ex*2 > vips.length };
}
function btCheckWin(){
  if(!btActive() || !state.bt.ready) return null;
  const r = btResult();
  if(!state.fleets[r.def].some(s=>!s.destroyed)){
    state.btEndNote = r.def==='ai' ? 'VICTORY! Every enemy defender has been sunk.' : 'DEFEAT. Every one of your defenders has been sunk.';
    return r.atk;
  }
  if(r.vips.every(v=>v.destroyed)){
    const w = r.attackerWins ? r.atk : r.def;
    state.btEndNote = btEndText(r, w);
    return w;
  }
  return null;
}
function btEndText(r, winner){
  const youAtk = r.atk==='player';
  const got = `${r.ex} of ${r.vips.length} VIP${r.vips.length>1?'s':''} extracted (${r.need} needed)`;
  if(winner==='player') return youAtk ? `VICTORY! ${got}.` : `VICTORY! The enemy VIPs were stopped — ${got}.`;
  return youAtk ? `DEFEAT. The breakthrough failed — ${got}.` : `DEFEAT. The enemy broke through — ${got}.`;
}
// After the last Firing phase of the round limit.
function btRoundLimitReached(){
  if(!btActive() || state.round < BT_ROUND_LIMIT) return null;
  const r = btResult();
  const w = r.attackerWins ? r.atk : r.def;
  state.btEndNote = 'Round limit reached. ' + btEndText(r, w);
  return w;
}

/* ---------- AI: choosing where to go ---------- */
function btMaxRange(s){
  let r = 0;
  [s.broadsidePort, s.broadsideStarboard, s.turretWeapons].forEach(arr=>arr.forEach(e=>{ if(e) r = Math.max(r, WEAPONS[e.weapon].range); }));
  return r || 40;
}
function btProjectVip(v, k){
  const g = state.bt.gate, d = dist(v.x,v.y,g.x,g.y);
  const step = Math.min(d, k*v.movement*0.85);
  if(d<1e-6) return {x:v.x,y:v.y};
  return { x: v.x + (g.x-v.x)/d*step, y: v.y + (g.y-v.y)/d*step };
}
// What the AI ship should do in Breakthrough: {target} to fight that ship in the usual way, or {x,y,goal} to steer for a point.
function aiBtSteer(s){
  if(kothActive()) return kothSteer(s);
  if(!btActive() || !state.bt.ready) return null;
  const bt = state.bt, g = bt.gate;
  const mine = state.fleets.ai.filter(o=>!o.destroyed), foes = state.fleets.player.filter(e=>!e.destroyed);
  if(!foes.length) return null;
  const nearest = foes.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b);
  if(btRoleOf(s)==='attacker'){
    if(s.isVip) return { x:g.x, y:g.y, goal:'exit' };
    const vips = mine.filter(o=>o.isVip);
    const threats = foes.filter(e=> vips.some(v=>dist(v.x,v.y,e.x,e.y)<260) || dist(s.x,s.y,e.x,e.y)<140);
    if(threats.length) return { target: threats.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b), goal:'engage' };
    if(vips.length){
      const v = vips.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b);
      const d = dist(v.x,v.y,g.x,g.y) || 1;
      return { x: v.x + (g.x-v.x)/d*50, y: v.y + (g.y-v.y)/d*50, goal:'escort' };
    }
    return { x:g.x, y:g.y, goal:'exit' };
  }
  // Defender: go for a VIP it can strike now or within the next few turns; otherwise fight the nearest ship.
  const vips = foes.filter(e=>e.isVip);
  if(vips.length){
    const range = btMaxRange(s);
    let best = null;
    vips.forEach(v=>{
      for(let k=0;k<=3;k++){
        const pos = btProjectVip(v,k);
        if(dist(s.x,s.y,pos.x,pos.y) - range*0.8 <= k*s.movement*0.9){
          const score = k*1000 + dist(s.x,s.y,pos.x,pos.y);
          if(!best || score<best.score) best = { pos, score };
          break;
        }
      }
    });
    if(best) return { x:best.pos.x, y:best.pos.y, goal:'hunt' };
  }
  if(dist(s.x,s.y,nearest.x,nearest.y) < 450) return { target:nearest, goal:'engage' };
  const inward = bt.exitEdge==='east' ? -120 : 120;
  return { x:g.x+inward, y:g.y, goal:'picket' };
}

/* ============================== KING OF THE HILL ============================== */
// Two equal fleets deploy hidden on opposite edges of an 800"x800" board. A circular Hill (200" across) sits at the centre.
// At the end of every Firing phase the side with more presence weight inside the Hill scores a point.
// First to the target wins; otherwise the higher score when the chosen number of rounds is up. Sinking the enemy fleet wins outright.
const KOTH_DEPTH = 150, KOTH_RADIUS = 100;
const KOTH_ROUND_CHOICES = [10,13,15,17];
const KOTH_TARGET = {10:6, 13:8, 15:9, 17:10};
const KOTH_WEIGHT = {'Frigate':1,'Destroyer':1,'Light Cruiser':2,'Medium Cruiser':2,'Heavy Cruiser':3,'Battleship':3};
let kothOpt = { rounds:15 };
function kothHillBox(){ const h = state.bt.hill; return { x:h.x-h.r, y:h.y-h.r, w:2*h.r, h:2*h.r }; }
function kothMakeZones(rounds){
  const orient = Math.random()<0.5 ? 'ew' : 'ns';
  const playerFirst = Math.random()<0.5;   // which of the two opposite edges the player gets
  let pRect, aRect, pHeading, aHeading, pEdge, aEdge;
  if(orient==='ew'){
    const west = {x:0,y:0,w:KOTH_DEPTH,h:BOARD_H}, east = {x:BOARD_W-KOTH_DEPTH,y:0,w:KOTH_DEPTH,h:BOARD_H};
    if(playerFirst){ pRect=west; aRect=east; pHeading=90; aHeading=270; pEdge='west'; aEdge='east'; }
    else { pRect=east; aRect=west; pHeading=270; aHeading=90; pEdge='east'; aEdge='west'; }
  } else {
    const north = {x:0,y:0,w:BOARD_W,h:KOTH_DEPTH}, south = {x:0,y:BOARD_H-KOTH_DEPTH,w:BOARD_W,h:KOTH_DEPTH};
    if(playerFirst){ pRect=north; aRect=south; pHeading=180; aHeading=0; pEdge='north'; aEdge='south'; }
    else { pRect=south; aRect=north; pHeading=0; aHeading=180; pEdge='south'; aEdge='north'; }
  }
  return { koth:true, orient, pRect, aRect, pHeading, aHeading, pEdge, aEdge,
    hill:{ x:BOARD_W/2, y:BOARD_H/2, r:KOTH_RADIUS }, rounds, target:KOTH_TARGET[rounds],
    score:{ player:0, ai:0 }, ready:false, lastHolder:null };
}
function kothBriefingStart(){
  $id('fitmentScreen').style.display='none';
  state.bt = kothMakeZones(kothOpt.rounds);
  [...state.fleets.player, ...state.fleets.ai].forEach(s=>{ s.isVip=false; s.placed=false; s.extracted=false; s.depPreview=null; });
  kothRenderBriefing();
  $id('btBriefModal').classList.add('show');
}
function kothRenderBriefing(){
  const bt = state.bt;
  $id('btBriefBox').innerHTML = `<h1>King of the Hill — Mission Briefing</h1>
    <p>Hold the <b style="color:#ffd84a">Hill</b> (the circle at the centre of the board, 200" across) at the end of each Firing phase to score a point.</p>
    <ul>
      <li>You deploy on the <b>${bt.pEdge}</b> edge, the enemy on the <b>${bt.aEdge}</b> edge. Both fleets are placed in secret and revealed together.</li>
      <li>A ship is in the Hill when its centre is inside the circle. Each ship counts for its class: Frigate 1, Destroyer 1, Light Cruiser 2, Medium Cruiser 2, Heavy Cruiser 3, Battleship 3. A ship that is Dead in the Water counts for half, rounded down.</li>
      <li>The side with the higher total scores 1 point. A tie, or an empty Hill, scores nothing.</li>
      <li>The first side to reach the target wins. If nobody does by the last round, the higher score wins (ties go to the larger surviving fleet by weight, then by hull points).</li>
      <li>Sinking the whole enemy fleet wins at once. Ramming is allowed, so you can shove rivals off the Hill.</li>
    </ul>
    <h3>Length of battle</h3>
    <div class="row" id="kothRoundPick" style="justify-content:center;gap:8px;margin:6px 0;">
      ${KOTH_ROUND_CHOICES.map(n=>`<button data-r="${n}" class="${n===bt.rounds?'primary':''}">${n} rounds<br><small>first to ${KOTH_TARGET[n]}</small></button>`).join('')}
    </div>
    <div class="row" style="justify-content:center;margin-top:12px;gap:10px;">
      <button id="btBriefBackBtn">← Back</button>
      <button class="primary" id="btBriefGoBtn">Begin Deployment →</button>
    </div>`;
  $id('kothRoundPick').querySelectorAll('button').forEach(b=>{
    b.onclick = ()=>{ const n = +b.dataset.r; kothOpt.rounds = n; bt.rounds = n; bt.target = KOTH_TARGET[n]; kothRenderBriefing(); };
  });
  $id('btBriefBackBtn').onclick = ()=>{ $id('btBriefModal').classList.remove('show'); $id('fitmentScreen').style.display='flex'; renderFitmentScreen(); };
  $id('btBriefGoBtn').onclick = ()=>{ $id('btBriefModal').classList.remove('show'); btStartDeployment(); };
}

/* ---------- Scoring ---------- */
function kothInHill(s){ const h = state.bt.hill; return dist(s.x,s.y,h.x,h.y) <= h.r; }
function kothWeightOf(s){
  const w = KOTH_WEIGHT[s.type] || 1;
  return deadWater(s) ? Math.floor(w/2) : w;
}
function kothPresence(side){
  return state.fleets[side].filter(s=>!s.destroyed && s.structureCur>0 && kothInHill(s)).reduce((n,s)=>n+kothWeightOf(s),0);
}
function kothHolder(){
  const p = kothPresence('player'), a = kothPresence('ai');
  return { p, a, holder: p>a ? 'player' : (a>p ? 'ai' : null) };
}
function kothScoreRound(){
  if(!kothActive() || !state.bt.ready) return;
  const bt = state.bt, h = kothHolder();
  bt.lastHolder = h.holder;
  if(h.holder){
    bt.score[h.holder]++;
    logMsg(h.holder==='player'?'hit':'dmg', `${h.holder==='player'?'You hold':'The enemy holds'} the Hill (${h.p} vs ${h.a}) and score a point. Score: you ${bt.score.player}, enemy ${bt.score.ai}.`);
  } else {
    logMsg('sys', h.p+h.a>0 ? `The Hill is contested (${h.p} vs ${h.a}) — no point scored.` : 'Nobody holds the Hill — no point scored.');
  }
}
function kothFleetWeight(side){ return state.fleets[side].filter(s=>!s.destroyed).reduce((n,s)=>n+(KOTH_WEIGHT[s.type]||1),0); }
function kothHullPoints(side){ return state.fleets[side].filter(s=>!s.destroyed).reduce((n,s)=>n+s.structureCur,0); }
function kothCheckWin(){
  if(!kothActive() || !state.bt.ready) return null;
  const pAlive = state.fleets.player.some(s=>!s.destroyed), aAlive = state.fleets.ai.some(s=>!s.destroyed);
  if(!aAlive && pAlive){ state.btEndNote = 'VICTORY! The enemy fleet is annihilated.'; return 'player'; }
  if(!pAlive){ state.btEndNote = 'DEFEAT. Your fleet has been destroyed.'; return 'ai'; }
  return null;
}
function kothEndCheck(){
  if(!kothActive() || !state.bt.ready) return null;
  const bt = state.bt, sc = bt.score;
  const line = `Final score: you ${sc.player}, enemy ${sc.ai}.`;
  if(sc.player>=bt.target || sc.ai>=bt.target){
    const w = sc.player>=bt.target ? 'player' : 'ai';
    state.btEndNote = (w==='player' ? 'VICTORY! You reached the target score first. ' : 'DEFEAT. The enemy reached the target score first. ') + line;
    return w;
  }
  if(state.round >= bt.rounds){
    let w = null, why = '';
    if(sc.player!==sc.ai){ w = sc.player>sc.ai ? 'player' : 'ai'; why = 'The rounds are up and the higher score wins. '; }
    else if(kothFleetWeight('player')!==kothFleetWeight('ai')){ w = kothFleetWeight('player')>kothFleetWeight('ai') ? 'player' : 'ai'; why = 'The rounds are up with the scores tied — the larger surviving fleet wins. '; }
    else { w = kothHullPoints('player')>=kothHullPoints('ai') ? 'player' : 'ai'; why = 'The rounds are up with the scores and fleets level — the sounder hulls win. '; }
    state.btEndNote = (w==='player' ? 'VICTORY! ' : 'DEFEAT. ') + why + line;
    return w;
  }
  return null;
}

/* ---------- Drawing and HUD ---------- */
function kothDrawZones(scale){
  const bt = state.bt, h = bt.hill;
  const c = worldToScreen(h.x, h.y), e = worldToScreen(h.x+h.r, h.y), R = Math.abs(e.x-c.x);
  let col = '255,216,74', tag = 'THE HILL';
  if(bt.ready){
    const k = kothHolder();
    if(k.holder==='player'){ col = '92,184,255'; tag = 'THE HILL — YOURS'; }
    else if(k.holder==='ai'){ col = '255,110,90'; tag = 'THE HILL — ENEMY'; }
    else if(k.p+k.a>0){ tag = 'THE HILL — CONTESTED'; }
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI*2);
  ctx.fillStyle = `rgba(${col},0.13)`; ctx.fill();
  ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 3; ctx.setLineDash([]); ctx.stroke();
  ctx.fillStyle = `rgb(${col})`; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('♛ '+tag, c.x, c.y - R + 16);
  ctx.restore();
  if(state.phase==='deploy'){
    const box = (r, fill, stroke, label, bold)=>{
      const a = worldToScreen(r.x, r.y), b = worldToScreen(r.x+r.w, r.y+r.h);
      ctx.save(); ctx.fillStyle = fill; ctx.fillRect(a.x, a.y, b.x-a.x, b.y-a.y);
      ctx.strokeStyle = stroke; ctx.lineWidth = bold?3:1.5; ctx.setLineDash([8,6]); ctx.strokeRect(a.x, a.y, b.x-a.x, b.y-a.y); ctx.setLineDash([]);
      ctx.fillStyle = stroke; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(label, (a.x+b.x)/2, (a.y+b.y)/2); ctx.restore();
    };
    box(bt.pRect, `rgba(70,160,255,${state.deployDrag?0.22:0.13})`, '#5cb8ff', 'YOUR DEPLOYMENT ZONE', true);
    box(bt.aRect, 'rgba(255,110,90,0.07)', '#ff7a66', 'ENEMY DEPLOYMENT ZONE', false);
  }
}
function kothUpdateHud(el){
  const bt = state.bt;
  if(state.phase==='deploy'){ el.innerHTML = '<b>KING OF THE HILL</b> · deployment'; return; }
  const k = kothHolder();
  const who = k.holder==='player' ? '<span style="color:#5cb8ff">yours</span>' : (k.holder==='ai' ? '<span style="color:#ff7a66">enemy</span>' : (k.p+k.a>0?'contested':'empty'));
  el.innerHTML = `<span style="color:#ffd84a">♛</span> You <b style="color:#5cb8ff">${bt.score.player}</b> – <b style="color:#ff7a66">${bt.score.ai}</b> Enemy · first to ${bt.target} · Hill: ${who} · <b>R${Math.min(state.round,bt.rounds)}/${bt.rounds}</b>`;
}

/* ---------- AI ---------- */
// Head for the Hill, spread out across it, hold it, and fight whatever contests it. Badly hurt ships hang back at the rim.
function kothSteer(s){
  if(!state.bt.ready) return null;
  const bt = state.bt, h = bt.hill;
  const foes = state.fleets.player.filter(e=>!e.destroyed);
  if(!foes.length) return null;
  const nearest = foes.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b);
  const mates = state.fleets.ai.filter(o=>!o.destroyed);
  const idx = Math.max(0, mates.indexOf(s)), n = Math.max(1, mates.length);
  const dHill = dist(s.x,s.y,h.x,h.y);
  const hurt = s.structureCur < 0.35*s.structureMax;
  // a personal slot inside the Hill so the fleet doesn't pile onto one point
  const ang = (idx/n)*Math.PI*2 + 0.6, rad = h.r*0.5;
  const slot = { x:h.x+Math.cos(ang)*rad, y:h.y+Math.sin(ang)*rad };
  if(hurt && dHill < h.r + 60){
    const away = bearingFromTo(nearest.x, nearest.y, h.x, h.y) * DEG2RAD;
    return { x: h.x + Math.sin(away)*(h.r+25), y: h.y - Math.cos(away)*(h.r+25), goal:'rim' };
  }
  const reach = btMaxRange(s);
  const dn = dist(s.x,s.y,nearest.x,nearest.y);
  const nearHill = dist(nearest.x,nearest.y,h.x,h.y) < h.r + 50;
  if(dHill <= h.r){
    if(dn < reach*1.3 && nearHill) return { target:nearest, goal:'engage' };
    return { x:slot.x, y:slot.y, goal:'hold' };
  }
  if(dn < 90) return { target:nearest, goal:'engage' };
  return { x:slot.x, y:slot.y, goal:'seize' };
}

let leftDrag = null; // {startMx,startMy,curMx,curMy,shiftKey,moved} — left button click vs. box-select drag
const CLICK_DRAG_THRESHOLD = 4; // px of movement before a mousedown counts as a drag, not a click

canvas.addEventListener('mousedown', (e)=>{
  if(e.button!==0) return; // left button only — right button is camera pan, handled below
  if(state.activeSide!=='player' || state.gameOver) return;
  const rect = canvas.getBoundingClientRect();
  const mx=e.clientX-rect.left, my=e.clientY-rect.top;
  if((state.phase==='movement' || state.phase==='firing') && state.selectedShipId){
    const gs = shipById(state.selectedShipId);
    if(gs && gs.side==='player' && !gs.destroyed){
      // Re-floating a grounded ship: rotate it (grab the heading handle) or drag it directly.
      if(state.phase==='movement' && gs.grounded && gs.grounded.phase==='ready'){
        const handleWorld = refloatHandlePos(gs);
        const hp = worldToScreen(handleWorld.x, handleWorld.y);
        if(Math.hypot(hp.x-mx,hp.y-my) < 14){
          state.refloatRotateDrag = { ship:gs };
          return;
        }
        const cur = gs.refloatPending || {x:gs.x, y:gs.y};
        const p = worldToScreen(cur.x, cur.y);
        if(Math.hypot(p.x-mx,p.y-my) < 18){
          state.refloatDrag = { ship:gs };
          return;
        }
      }
      // Dragging FROM the selected, ungrounded ship sets its course for this phase — but only once:
      // a ship whose movement is confirmed has spent its move for the phase.
      if(!gs.grounded && canPlotMoveNow(gs)){
        const dp = getDrawPos(gs);
        const p = worldToScreen(dp.x, dp.y);
        if(Math.hypot(p.x-mx,p.y-my) < 18){
          state.moveTargetDrag = { ship:gs, startMx:mx, startMy:my, moved:false };
          return;
        }
      }
    }
  } else if(state.phase==='special' && state.selectedShipId){
    const gs = shipById(state.selectedShipId);
    if(gs && gs.side==='player' && !gs.destroyed && gs.specialOrderMode==='course' && !gs.courseConfirmed){
      const handleWorld = courseHandlePos(gs);
      const hp = worldToScreen(handleWorld.x, handleWorld.y);
      if(Math.hypot(hp.x-mx,hp.y-my) < 14){
        state.courseRotateDrag = { ship:gs };
        return;
      }
    }
  }
  leftDrag = { startMx:mx, startMy:my, curMx:mx, curMy:my, shiftKey:e.shiftKey, moved:false };
});
// Where the re-float rotation handle sits: a fixed distance out from the ship's current
// (possibly still-being-dragged) position, along whatever heading it's currently set to.
function refloatHandlePos(s){
  const dp = getDrawPos(s);
  const rad = dp.heading*DEG2RAD;
  return { x: dp.x + Math.sin(rad)*22, y: dp.y - Math.cos(rad)*22 };
}

// Where a ship's Course Adjustment rotation handle sits — same fixed distance out from the bow
// as the re-float handle, but the ship's OWN position never moves this phase, so it's simply
// anchored at (s.x, s.y) rather than a possibly-still-dragging draw position.
function courseHandlePos(s){
  const heading = s.courseAdjustHeading!=null ? s.courseAdjustHeading : s.courseHeadingStart;
  const rad = heading*DEG2RAD;
  return { x: s.x + Math.sin(rad)*22, y: s.y - Math.cos(rad)*22 };
}
// The dashed wedge showing how far a ship may swing (half its turning stat, either side of the
// heading it had when the phase began) plus the drag handle itself — same visual language as
// the re-float handle, just angle-limited instead of a free spin.
function drawCourseAdjustRange(s, scale){
  const half = s.turning/2;
  const p = worldToScreen(s.x, s.y);
  const R = 60*scale;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p.x,p.y);
  ctx.arc(p.x,p.y,R,(s.courseHeadingStart-half-90)*DEG2RAD,(s.courseHeadingStart+half-90)*DEG2RAD);
  ctx.closePath();
  ctx.fillStyle = 'rgba(232,193,90,0.08)';
  ctx.fill();
  ctx.setLineDash([5,4]);
  ctx.strokeStyle = 'rgba(232,193,90,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  const handleWorld = courseHandlePos(s);
  const hp = worldToScreen(handleWorld.x, handleWorld.y);
  ctx.save();
  ctx.strokeStyle = 'rgba(232,193,90,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(hp.x, hp.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hp.x, hp.y, 7, 0, 7);
  ctx.fillStyle = state.courseRotateDrag ? '#ffe08a' : 'rgba(232,193,90,0.9)';
  ctx.fill();
  ctx.strokeStyle = '#1a0a05'; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

window.addEventListener('mousemove', (e)=>{
  if(state.refloatDrag){
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX-rect.left, e.clientY-rect.top);
    const s = state.refloatDrag.ship;
    const contact = s.grounded.contact;
    let nx=world.x, ny=world.y;
    const d = dist(world.x, world.y, contact.x, contact.y);
    if(d>30){
      const ang = Math.atan2(world.y-contact.y, world.x-contact.x);
      nx = contact.x + Math.cos(ang)*30;
      ny = contact.y + Math.sin(ang)*30;
    }
    s.refloatPending = { x: Math.max(0,Math.min(BOARD_W,nx)), y: Math.max(0,Math.min(BOARD_H,ny)) };
    render();
    return;
  }
  if(state.moveTargetDrag){
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX-rect.left, e.clientY-rect.top);
    const s = state.moveTargetDrag.ship;
    if(!state.moveTargetDrag.moved){
      const r0 = canvas.getBoundingClientRect();
      if(Math.hypot(e.clientX-r0.left-state.moveTargetDrag.startMx, e.clientY-r0.top-state.moveTargetDrag.startMy) <= CLICK_DRAG_THRESHOLD) return; // still just a click
      state.moveTargetDrag.moved = true;
    }
    const tx = Math.max(0, Math.min(BOARD_W, world.x));
    const ty = Math.max(0, Math.min(BOARD_H, world.y));
    state.moveDraft = computeDragPlan(s, tx, ty);
    // Show the ship itself following the drag, at wherever that plan actually resolves to
    // (constrained by MSMD/turning/speed) — not just teleported straight to the cursor.
    const path = computePath(s, state.moveDraft);
    s.moveDragPreview = { x: path.endX, y: path.endY, heading: path.endHeading };
    render();
    return;
  }
  if(state.refloatRotateDrag){
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX-rect.left, e.clientY-rect.top);
    const s = state.refloatRotateDrag.ship;
    const center = s.refloatPending || {x:s.x, y:s.y};
    // Free rotation — any direction at all, not limited by the ship's normal turning stat.
    s.refloatHeading = bearingFromTo(center.x, center.y, world.x, world.y);
    render();
    return;
  }
  if(state.courseRotateDrag){
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX-rect.left, e.clientY-rect.top);
    const s = state.courseRotateDrag.ship;
    // Limited rotation — clamped to half the ship's turning stat, either side of the heading it
    // had when the Special Orders phase began (not wherever it's currently pointed).
    const raw = bearingFromTo(s.x, s.y, world.x, world.y);
    const half = s.turning/2;
    const clampedDelta = Math.max(-half, Math.min(half, angDiff(raw, s.courseHeadingStart)));
    s.courseAdjustHeading = normDeg(s.courseHeadingStart + clampedDelta);
    render();
    return;
  }
});
window.addEventListener('mouseup', (e)=>{
  if(state.refloatDrag){ state.refloatDrag = null; renderPanel(); return; }
  if(state.refloatRotateDrag){ state.refloatRotateDrag = null; renderPanel(); return; }
  if(state.courseRotateDrag){ state.courseRotateDrag = null; renderPanel(); return; }
  if(state.moveTargetDrag){
    const s = state.moveTargetDrag.ship;
    const wasClick = !state.moveTargetDrag.moved;
    s.moveDragPreview = null; // let go — ship settles back until Confirm (and later the sweep)
    state.moveTargetDrag = null;
    if(wasClick && state.selectedShipId===s.id){ toggleShipOpen(s.id); return; } // clicking the selected ship again closes it
    render(); renderPanel();
    return;
  }
});
window.addEventListener('mousemove', (e)=>{
  if(!leftDrag) return;
  const rect = canvas.getBoundingClientRect();
  leftDrag.curMx = e.clientX-rect.left; leftDrag.curMy = e.clientY-rect.top;
  if(!leftDrag.moved && Math.hypot(leftDrag.curMx-leftDrag.startMx, leftDrag.curMy-leftDrag.startMy) > CLICK_DRAG_THRESHOLD){
    leftDrag.moved = true;
  }
  if(leftDrag.moved) render();
});
window.addEventListener('mouseup', (e)=>{
  if(!leftDrag || (e.button!==undefined && e.button!==0)) return;
  const drag = leftDrag; leftDrag = null;
  if(drag.moved){
    closeMineInspector(); // a box-select drag also counts as "clicking off" any open mine inspector
    // Box-select: every player ship whose screen position falls inside the dragged rectangle.
    const x0=Math.min(drag.startMx,drag.curMx), x1=Math.max(drag.startMx,drag.curMx);
    const y0=Math.min(drag.startMy,drag.curMy), y1=Math.max(drag.startMy,drag.curMy);
    const hit = state.fleets.player.filter(s=>{
      if(s.destroyed) return false;
      const dp = getDrawPos(s);
      const p = worldToScreen(dp.x,dp.y);
      return p.x>=x0 && p.x<=x1 && p.y>=y0 && p.y<=y1;
    }).map(s=>s.id);
    // (Box-select is gone: ships are picked from the fleet list, one at a time.)
    render();
    return;
  }
  // A plain click (no drag).
  const best = shipAtScreenPoint(drag.curMx, drag.curMy);
  const clickedMine = best ? null : mineAtScreenPoint(drag.curMx, drag.curMy);
  // Any click other than on the mine already being watched closes that inspector — "clicking
  // off" it, whether onto a ship, a different mine, or empty water.
  if(!(clickedMine && mineInspectWindow && mineInspectWindow.mineId===clickedMine.id)){
    closeMineInspector();
  }
  if(best && best.side==='player'){
    // While one of your ships is open, the map can't be used to switch to another: use the fleet list.
    // (With nothing open, clicking a ship opens it.)
    if(!state.selectedShipId){
      selectShip(best.id);
    } else if(best.id===state.selectedShipId){
      toggleShipOpen(best.id);   // clicking the ship that is already selected unselects it
    }
  } else if(best && state.phase==='movement' && canPickTurretTarget(shipById(state.selectedShipId))){
    // Clicking an enemy ship while one of yours is selected picks it as that ship's turret target
    // (it still has to be locked in with Confirm Target).
    const sel = shipById(state.selectedShipId);
    sel.aimTargetId = best.id; renderPanel(); render();
  } else if(clickedMine){
    openMineInspector(clickedMine);
  }
  // (Clicking empty water no longer closes the open ship: close it from the fleet list.)
});

/* ============================== CAMERA: zoom (scroll) + pan (right-drag) ============================== */
canvas.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX-rect.left, my = e.clientY-rect.top;
  const before = screenToWorld(mx,my);
  const factor = e.deltaY < 0 ? 1.15 : (1/1.15);
  state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoom*factor));
  const after = screenToWorld(mx,my);
  state.viewCenter.x += before.x - after.x;
  state.viewCenter.y += before.y - after.y;
  clampViewCenter();
  render();
}, {passive:false});

canvas.addEventListener('contextmenu', (e)=> e.preventDefault());

let panDrag = null;
canvas.addEventListener('mousedown', (e)=>{
  if(e.button===2){ // right mouse button = pan
    const rect = canvas.getBoundingClientRect();
    panDrag = { startMx:e.clientX-rect.left, startMy:e.clientY-rect.top, startCenter:{x:state.viewCenter.x,y:state.viewCenter.y} };
  }
});
window.addEventListener('mousemove', (e)=>{
  if(!panDrag) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX-rect.left, my = e.clientY-rect.top;
  const scale = fitScale()*state.zoom*PX;
  state.viewCenter.x = panDrag.startCenter.x - (mx-panDrag.startMx)/scale;
  state.viewCenter.y = panDrag.startCenter.y - (my-panDrag.startMy)/scale;
  clampViewCenter();
  render();
});
window.addEventListener('mouseup', ()=>{ panDrag=null; });

// All Ahead Full: during the Firing phase (before shots are commenced) such a ship plots an extra move instead of firing.
function extraMoveMode(s){
  return !!s && state.phase==='firing' && state.activeSide==='player' && !state.firingCommenced && s.side==='player'
    && s.activeOrder==='full' && !s.destroyed && !s.grounded;
}
// Can this ship have a move plotted for it right now (ordinary Movement-phase move, or an All Ahead Full extra move)?
function canPlotMoveNow(s){
  if(!s) return false;
  if(state.phase==='movement') return !s.movementPlan;
  return extraMoveMode(s) && !s.extraPlan;
}
function selectShip(id){
  replaceSelection([id]);
  const s = shipById(id);
  if(canPlotMoveNow(s)){
    state.moveDraft = defaultMoveDraft(s);
  }
  renderPanel();
  render();
}

/* ============================== ROUND / PHASE FLOW ============================== */
function beginRound(){
  clearCritPopups(); // last round's Critical Damage pop-ups have done their job
  document.getElementById('roundNo').textContent = state.round;
  state.phase='movement';
  state.activeSide='player';
  // Orders chosen in the last Special Orders phase now take effect: All Ahead Full (an extra move in this round's
  // Firing phase) or Full Reverse Stop (no ordinary move this Movement phase).
  allShips().forEach(s=>{ s.activeOrder = s.nextOrder || null; s.nextOrder = null; s.extraPlan = null; });
  allShips().filter(s=>!s.destroyed && s.activeOrder).forEach(s=>{
    logMsg('sys', `${shipLabel(s)} is under orders: ${s.activeOrder==='full'?'ALL AHEAD FULL (it will make an extra move instead of firing)':'FULL REVERSE STOP (it only coasts, and is easier to hit)'}.`);
  });
  allShips().forEach(advanceCriticalState); // repair rolls for crippled ships (both fleets)
  allShips().forEach(s=>{ s.turretSyncHeading = s.heading; }); // every turret starts the phase settled against its hull
  // shield regen at start of movement phase, per side, for each side's own ships when it becomes their movement
  regenShields('player');
  state.fleets.player.forEach(s=>{
    s.movementPlan=null; s.firedThisRound={broadside:false,turret:false,torpedo:false}; resetWeaponShots(s);
    s.moveDragPreview=null; // safety net: never let a stray drag-preview outlive its round
    advanceGroundedState(s);
    if(s.grounded && s.grounded.phase==='frozen'){
      s.movementPlan = {speed:0, turns:[], minePlacedAtCum:null}; // stuck fast — auto-skip this turn
    }
  });
  state.selectedShipIds.clear(); state.selectedShipId=null; state.moveDraft=null;
  state.roundMovePaths = [];
  // A ship that is dead in the water can't be given movement orders: it coasts on its own at minimum speed.
  const coasters = state.fleets.player.filter(s=>!s.destroyed && !s.movementPlan && !s.grounded && (s.activeOrder==='reverse' || (s.crit && s.crit.kind==='dead')));
  coasters.forEach(s=>{ logMsg('sys', s.activeOrder==='reverse' ? `${shipLabel(s)} goes Full Reverse Stop and only coasts ahead.` : `${shipLabel(s)} is dead in the water and coasts ahead.`); confirmShipMovement(s, defaultMoveDraft(s)); });
  if(coasters.length){
    checkMineDetonations();
    const winner = checkWin();
    if(winner){ endGame(winner, winner==='player'?'victory':'defeat'); return; }
  }
  updatePhaseBanner();
  renderPanel();
  render();
}
// Grounded state machine: 'frozen' the round right after contact (can't move at all), then
// 'ready' the round after that (the player may perform the re-floating action instead of a
// normal move). Advances by one step each time the ship's side's movement phase begins.
function advanceGroundedState(s){
  if(!s.grounded || s.grounded.phase!=='frozen') return;
  if(s.grounded.roundsFrozen>=1){ s.grounded.phase='ready'; }
  else { s.grounded.roundsFrozen = (s.grounded.roundsFrozen||0)+1; }
}

function regenShields(side){
  state.fleets[side].filter(s=>!s.destroyed).forEach(s=>{
    ARCS.forEach(a=>{ if(a!=='stern'){ s.shields[a] = Math.min(s.shieldsMax, s.shields[a]+s.shieldRegen); } });
  });
}

function updatePhaseBanner(){
  const titleEl = document.getElementById('phaseBannerTitle');
  const subEl = document.getElementById('phaseBannerSub');
  const advBtn = document.getElementById('phaseAdvanceBtn');
  const skipBtn = document.getElementById('phaseSkipBtn');
  btUpdateHud();
  if(state.phase==='deploy' && !state.gameOver){
    titleEl.textContent = 'DEPLOYMENT';
    subEl.textContent = 'Place your ships, then press Ready';
    advBtn.style.display='none'; skipBtn.style.display='none';
    return;
  }
  advBtn.disabled = false; // default; only the "Commence Firing" branch below overrides this
  if(state.gameOver){
    titleEl.textContent = state.gameOverReason==='surrender'
      ? (state.gameOverWinner==='player' ? 'ENEMY SURRENDERED' : 'SURRENDERED')
      : (state.gameOverWinner==='player' ? 'VICTORY' : 'DEFEAT');
    subEl.textContent = 'See the summary';
    advBtn.style.display='none';
    skipBtn.style.display='none';
    return;
  }
  const phaseNames = {movement:'MOVEMENT', firing:'FIRING', special:'SPECIAL ORDERS'};
  titleEl.textContent = phaseNames[state.phase] || state.phase.toUpperCase();
  const sideLabel = state.activeSide==='player' ? 'Your Fleet' : 'Enemy Fleet';
  let sub = `Round ${state.round} — ${sideLabel}`;
  if(state.activeSide==='player' && !state.selectedShipId){
    sub += state.phase==='special' ? ' · pick a ship from the fleet list for special orders' : ' · pick a ship from the fleet list for orders';
  }
  subEl.textContent = sub;
  // Persistent phase-advance control — firing is optional per ship, so this must stay
  // reachable even with no ship selected.
  if(state.activeSide==='player' && state.phase==='firing' && !state.firingCommenced){
    // Enabled as soon as any ship has an enemy within range and arc (and a clear line of sight). Ships with nothing
    // to shoot at never need to confirm. If a ship that DOES have a target hasn't confirmed, a pop-up asks first.
    advBtn.style.display='inline-block';
    advBtn.textContent = 'Commence Firing';
    const ready = firingReadiness();
    advBtn.disabled = ready.eligible.length===0 && ready.movers.length===0;
    advBtn.title = (ready.eligible.length===0 && ready.movers.length===0) ? 'No enemy is within range and firing arc of any of your ships — use Skip Firing Phase.' : '';
    advBtn.onclick = commenceFiringClicked;
  } else if(state.activeSide==='player' && state.phase==='firing' && state.firingCommenced){
    advBtn.style.display='inline-block';
    advBtn.disabled = false;
    advBtn.textContent = 'End Firing Phase →';
    advBtn.onclick = endFiringPhase;
  } else if(state.activeSide==='player' && state.phase==='special'){
    advBtn.style.display='inline-block';
    advBtn.textContent = 'End Special Orders Phase →';
    advBtn.onclick = endSpecialOrdersPhase;
  } else if(state.activeSide==='player' && state.phase==='movement' && allPlayerShipsPlanned()){
    // Every ship has either moved or is aground (and accounted for) this turn — offer to end here.
    advBtn.style.display='inline-block';
    advBtn.textContent = 'End Movement Phase →';
    advBtn.onclick = endMovementPhase;
  } else {
    advBtn.style.display='none';
  }
  if(state.activeSide==='player' && state.phase==='firing' && !state.firingCommenced){
    // Lets a player who has nothing to shoot at (but wants to use torpedoes) move straight on.
    skipBtn.style.display='inline-block';
    skipBtn.textContent = 'Skip Firing Phase →';
    skipBtn.onclick = skipFiringPhase;
  } else {
    skipBtn.style.display='none';
  }
}

// A ship counts as done for the turn once it's moved (movementPlan set) or is currently
// aground — whether it's stuck fast (frozen) or has a re-float available but untaken (ready);
// being aground satisfies the requirement on its own, the player doesn't have to re-float it
// before ending the phase.
function allPlayerShipsPlanned(){
  return state.fleets.player.filter(s=>!s.destroyed).every(s=> s.movementPlan || s.grounded);
}

// Core per-ship movement resolution, used when a ship's move is confirmed via the Movement panel.
function confirmShipMovement(s, plan){
  if(s.movementPlan) return false; // one movement per ship per Movement phase
  plan = critMovementPlan(s, plan);  // critical damage overrides whatever was ordered (dead in the water / jammed steering)
  const path = computePath(s, plan);
  s.movementPlan = plan;
  state.roundMovePaths.push({ship:s, points:path.points});
  // Hold the ship visually at its pre-move spot until the end-of-phase sweep actually plays,
  // even though its real position (below) updates immediately for game logic.
  s.moveAnim = {points: path.points, startTime: null, duration: 2000};
  s.x = path.endX; s.y = path.endY; s.heading = path.endHeading;
  applyMomentum(s, path.totalDist);
  const wentOOB = checkBoardBounds(s, path);
  const grounded = applyGroundingIfNeeded(s, path);
  if(!wentOOB && !grounded){
    logMsg('sys', `${shipLabel(s)} completes its movement (${path.totalDist.toFixed(0)}"). Next phase: ${(0.5*s.lastDistance).toFixed(0)}"–${s.movement.toFixed(0)}".`);
  }
  return true;
}

function confirmMovement(){
  const s = shipById(state.selectedShipId);
  if(!s || s.side!=='player' || s.movementPlan) return;
  confirmShipMovement(s, state.moveDraft);
  state.selectedShipIds.delete(s.id);
  setActiveFromSelection();
  state.moveDraft = state.selectedShipId ? defaultMoveDraft(shipById(state.selectedShipId)) : null;
  checkMineDetonations();
  render(); renderPanel();
  const winner = checkWin();
  if(winner){ endGame(winner, winner==='player'?'victory':'defeat'); return; }
}

function confirmRefloat(){
  const s = shipById(state.selectedShipId);
  if(!s || s.side!=='player' || !s.grounded || s.grounded.phase!=='ready') return;
  s.x = s.refloatPending.x; s.y = s.refloatPending.y; s.heading = s.refloatHeading;
  settleTurretWithHull(s);
  s.grounded = null;
  s.refloatPending = null;
  s.refloatHeading = null;
  s.moveAnim = null; s.moveDragPreview = null; // safety net — guarantee no stale animation/drag state survives
  s.lastDistance = 0; // freshly re-floated — no momentum carried over from before it grounded
  s.movementPlan = {speed:0, turns:[], minePlacedAtCum:null};
  logMsg('sys', `${shipLabel(s)} re-floats and is ready to sail again.`);
  state.selectedShipIds.delete(s.id);
  setActiveFromSelection();
  state.moveDraft = state.selectedShipId ? {speed:minSpeedFor(shipById(state.selectedShipId)), turns:[], minePlacedAtCum:null} : null;
  render(); renderPanel();
  const winner = checkWin();
  if(winner){ endGame(winner, winner==='player'?'victory':'defeat'); return; }
}

function checkMineDetonations(){
  state.mines = state.mines.filter(m=>{
    const targets = allShips().filter(s=>s.side!==m.side);
    for(const t of targets){
      if(dist(m.x,m.y,t.x,t.y) <= MINE_TRIGGER_RANGE){
        resolveAttack({gunnery:4, damage:20, ignoresShields:true}, t, bearingFromTo(m.x,m.y,t.x,t.y), MINE_TRIGGER_RANGE, 'Mine', 'Mine', shipById(m.shipId));
        return false; // consumed
      }
    }
    return true;
  });
}

/* ============================== RAMMING & SHIP-ON-SHIP COLLISIONS ============================== */
// Every hull is a narrow rectangle along its heading. During the movement sweep (every ship moving at once over the same
// 2 seconds) the first moment two hulls overlap is a collision, even if the ships would have ended the move apart.
// Both ships stop where they touch. Impact = rammer's distance / 5 (rounded up); each ship takes its share in proportion
// to the OTHER ship's size, so a small ship that rams a big one is wrecked and the big ship hardly notices.
// Impact damage ignores shields: it goes into the armor of the struck facing, then Structure (and can cause a critical).
const RAM_SIZE = {Frigate:1, Destroyer:1.5, 'Light Cruiser':2, 'Medium Cruiser':3, 'Heavy Cruiser':4, Battleship:6};
const RAM_SIDESWIPE_DEG = 30;      // headings closer than this (or opposite within this) = a glancing sideswipe
const RAM_SIDESWIPE_FACTOR = 0.5;  // sideswipes do half the damage
const RAM_STEPS = 240;
function hullCorners(x, y, heading, len, wid){
  const r = heading*DEG2RAD, fx = Math.sin(r), fy = -Math.cos(r), sx = Math.cos(r), sy = Math.sin(r);
  const hl = len/2, hw = wid/2;
  return [[1,1],[1,-1],[-1,-1],[-1,1]].map(([a,b])=>({x: x + fx*hl*a + sx*hw*b, y: y + fy*hl*a + sy*hw*b}));
}
function hullsOverlap(A, B){
  const axes = [];
  [A,B].forEach(poly=>{ for(let i=0;i<2;i++){ const p=poly[i], q=poly[i+1]; axes.push({x:-(q.y-p.y), y:q.x-p.x}); } });
  for(const ax of axes){
    let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity;
    A.forEach(p=>{ const d=p.x*ax.x+p.y*ax.y; a0=Math.min(a0,d); a1=Math.max(a1,d); });
    B.forEach(p=>{ const d=p.x*ax.x+p.y*ax.y; b0=Math.min(b0,d); b1=Math.max(b1,d); });
    if(a1<=b0 || b1<=a0) return false;
  }
  return true;
}
function pathIndexAt(points, tau){
  const target = tau * points[points.length-1].cum;
  let idx = 0;
  for(let i=0;i<points.length;i++){ if(points[i].cum <= target) idx = i; else break; }
  return idx;
}
function applyImpactDamage(s, arc, dmg){
  let rest = dmg, where = 'armor';
  const absorbed = Math.min(s.armor[arc], rest);
  s.armor[arc] -= absorbed; rest -= absorbed;
  if(rest>0){
    s.structureCur = Math.max(0, s.structureCur - rest);
    where = (absorbed>0 ? 'armor + ' : '') + 'STRUCTURE';
    recordStructureHit(s, 'Ram');
  }
  return where;
}
function resolveMovementCollisions(entries){
  entries = (entries || state.roundMovePaths).filter(e=>e.ship && !e.ship.destroyed && e.points && e.points.length>1);
  const byShip = new Map(entries.map(e=>[e.ship.id, e]));
  const ships = allShips().filter(s=>!s.destroyed && s.structureCur>0);
  const done = new Set();
  const poseAt = (s, tau)=>{
    const e = byShip.get(s.id);
    if(!e) return {x:s.x, y:s.y, heading:s.heading};
    const cut = e.cutTau!=null ? Math.min(tau, e.cutTau) : tau;
    const pt = e.points[pathIndexAt(e.points, cut)];
    return {x:pt.x, y:pt.y, heading:pt.heading};
  };
  const overlapAt = (a, b, tau)=>{
    const pa = poseAt(a,tau), pb = poseAt(b,tau);
    if(Math.hypot(pa.x-pb.x, pa.y-pb.y) > (a.hullLen+b.hullLen)) return false;
    return hullsOverlap(hullCorners(pa.x,pa.y,pa.heading,a.hullLen*0.92,a.hullWide*0.85),
                        hullCorners(pb.x,pb.y,pb.heading,b.hullLen*0.92,b.hullWide*0.85));
  };
  for(let guard=0; guard<ships.length; guard++){
    let best = null;
    for(let i=0;i<ships.length;i++) for(let j=i+1;j<ships.length;j++){
      const a=ships[i], b=ships[j];
      if(done.has(a.id) || done.has(b.id)) continue;
      if(!byShip.has(a.id) && !byShip.has(b.id)) continue;   // neither moved
      if(overlapAt(a,b,0)) continue;                          // already touching at the start: not a new collision
      for(let k=1;k<=RAM_STEPS;k++){
        const tau = k/RAM_STEPS;
        if(best && tau>=best.tau) break;
        if(overlapAt(a,b,tau)){ best = {a,b,tau:(k-1)/RAM_STEPS}; break; }
      }
    }
    if(!best) break;
    done.add(best.a.id); done.add(best.b.id);
    applyCollision(best.a, best.b, best.tau, byShip, poseAt);
  }
}
// After the impact the two hulls are shoved apart along the line between them so neither is left pinned against the
// other: the lighter ship is knocked back much further than the heavier one (the split is by size, same as the damage).
// The gap is wide enough that a ship pivoting away next turn clears its neighbour.
const RAM_PUSH_MARGIN = 8;   // extra clearance (inches, total) beyond just-touching
function separateColliders(a, b, pa, pb, info, byShip, tau){
  const sa = RAM_SIZE[a.type]||2, sb = RAM_SIZE[b.type]||2;
  let nx = pb.x-pa.x, ny = pb.y-pa.y, nl = Math.hypot(nx,ny);
  if(nl<0.01){ const r=pa.heading*DEG2RAD; nx=Math.sin(r); ny=-Math.cos(r); nl=1; }
  nx/=nl; ny/=nl;
  const fa = sb/(sa+sb), fb = sa/(sa+sb);        // the smaller ship moves the most
  const clearAt = (D, wa, wb)=>{
    const A = hullCorners(pa.x-nx*D*wa, pa.y-ny*D*wa, pa.heading, a.hullLen*0.92+RAM_PUSH_MARGIN, a.hullWide*0.85+RAM_PUSH_MARGIN);
    const B = hullCorners(pb.x+nx*D*wb, pb.y+ny*D*wb, pb.heading, b.hullLen*0.92+RAM_PUSH_MARGIN, b.hullWide*0.85+RAM_PUSH_MARGIN);
    return !hullsOverlap(A,B);
  };
  const okSpot = (x,y)=> x>3 && x<BOARD_W-3 && y>3 && y<BOARD_H-3 && !islandAt(x,y);
  let wa = fa, wb = fb, D = 0;
  while(D<60 && !clearAt(D,wa,wb)) D += 0.5;
  // never shove a ship onto an island or off the board: the other ship takes up the slack
  const dest = (p, sign, w)=>({x:p.x+sign*nx*D*w, y:p.y+sign*ny*D*w});
  const da = dest(pa,-1,wa), db = dest(pb,+1,wb);
  if(!okSpot(da.x,da.y)){ wb = 1; wa = 0; }
  else if(!okSpot(db.x,db.y)){ wa = 1; wb = 0; }
  [[a,pa,-1,wa],[b,pb,+1,wb]].forEach(([s,p,sign,w])=>{
    const to = {x:p.x+sign*nx*D*w, y:p.y+sign*ny*D*w};
    if(w<=0 || !okSpot(to.x,to.y)) return;
    const dPush = Math.hypot(to.x-p.x, to.y-p.y);
    if(dPush<0.05) return;
    s.x = to.x; s.y = to.y;
    const e = byShip.get(s.id);
    const travelled = info[s.id].travelled;
    const from = {x:p.x, y:p.y, heading:p.heading};
    const pushDur = Math.max(80, Math.min(350, 2000*(1-tau)));
    if(e && s.moveAnim && travelled>=1){
      // already sailing: keep the sweep, then slide to the new spot
      const pts = s.moveAnim.points.slice();
      const base = pts[pts.length-1].cum, mainDur = Math.max(50, 2000*e.cutTau);
      const extra = base*pushDur/mainDur;
      for(let k=1;k<=6;k++) pts.push({x:from.x+(to.x-from.x)*k/6, y:from.y+(to.y-from.y)*k/6, heading:from.heading, cum: base+extra*k/6});
      s.moveAnim.points = pts; s.moveAnim.duration = mainDur + pushDur;
    } else {
      // was barely moving: hold still until the impact, then slide
      const pts = [{x:from.x,y:from.y,heading:from.heading,cum:0},{x:to.x,y:to.y,heading:from.heading,cum:dPush}];
      s.moveAnim = {points: pts, startTime: null, duration: pushDur, delayMs: 2000*tau};
      if(!state.roundMovePaths.some(en=>en.ship===s)) state.roundMovePaths.push({ship:s, points:pts});
    }
  });
}
function applyCollision(a, b, tau, byShip, poseAt){
  const info = {};
  [a,b].forEach(s=>{
    const e = byShip.get(s.id);
    let travelled = 0;
    if(e){
      const idx = pathIndexAt(e.points, tau);
      const total = e.points[e.points.length-1].cum;
      const pt = e.points[idx];
      travelled = pt.cum;
      e.cutTau = total>0 ? pt.cum/total : 0;
      e.points = e.points.slice(0, idx+1);
      s.x = pt.x; s.y = pt.y; s.heading = pt.heading;
      const prev = s.momPrev || {movement:s.movement, distanceMoved:s.distanceMoved||0};
      // Stopped dead by the impact: all momentum is lost. The ship can move off at its ordinary base speed and turn at once,
      // instead of carrying its old speed straight back into the ship it hit.
      s.movement = s.baseMovement;
      s.lastDistance = 0;
      s.distanceMoved = prev.distanceMoved + travelled;
      if(s.moveAnim){
        s.moveAnim.points = e.points;
        s.moveAnim.duration = Math.max(50, 2000*e.cutTau);
      }
    }
    info[s.id] = {travelled, pose:{x:s.x,y:s.y,heading:s.heading}};
  });
  const pa = info[a.id].pose, pb = info[b.id].pose;
  const bAB = bearingFromTo(pa.x,pa.y,pb.x,pb.y), bBA = normDeg(bAB+180);
  const aBow = arcOfBearing(pa.heading, bAB)==='prow', bBow = arcOfBearing(pb.heading, bBA)==='prow';
  let hd = Math.abs(normDeg(pa.heading - pb.heading)); if(hd>180) hd = 360-hd;
  const dA = info[a.id].travelled, dB = info[b.id].travelled;
  let kind, impact, rammer = null;
  if(aBow && bBow){ kind='head-on'; impact = Math.ceil((dA+dB)/5); }
  else if(aBow || bBow){
    kind='ram';
    rammer = aBow ? a : b;
    const dR = rammer===a?dA:dB, dO = rammer===a?dB:dA;
    // Running into the back of a ship sailing the same way: only the closing speed counts.
    impact = Math.ceil((hd < RAM_SIDESWIPE_DEG ? Math.max(0, dR-dO) : dR)/5);
  } else {
    kind='sideswipe'; impact = Math.ceil(Math.max(dA,dB)/5*RAM_SIDESWIPE_FACTOR);
  }
  impact = Math.max(1, impact);
  const sa = RAM_SIZE[a.type]||2, sb = RAM_SIZE[b.type]||2;
  const dmgA = Math.max(1, Math.round(impact*sb/(sa+sb)));
  const dmgB = Math.max(1, Math.round(impact*sa/(sa+sb)));
  const arcA = arcOfBearing(pa.heading, bAB), arcB = arcOfBearing(pb.heading, bBA);
  const whereA = applyImpactDamage(a, arcA, dmgA), whereB = applyImpactDamage(b, arcB, dmgB);
  const label = {'head-on':'HEAD-ON COLLISION','sideswipe':'sideswipe','ram':'RAMMING'}[kind];
  const lead = kind==='ram' ? `${shipLabel(rammer)} rams ${shipLabel(rammer===a?b:a)}!` : `${shipLabel(a)} and ${shipLabel(b)} collide!`;
  logMsg('dmg', `${label}: ${lead} Impact ${impact}. ${shipLabel(a)} takes ${dmgA} on the ${arcA} (${whereA}); ${shipLabel(b)} takes ${dmgB} on the ${arcB} (${whereB}). Both ships stop dead.`);
  const cx = (pa.x+pb.x)/2, cy = (pa.y+pb.y)/2;
  setTimeout(()=>spawnEffect('explosion', cx, cy), Math.max(0, 2000*tau));
  separateColliders(a, b, pa, pb, info, byShip, tau);
}

function advanceToAiMovement(){
  state.activeSide='ai';
  updatePhaseBanner();
  regenShields('ai');
  state.fleets.ai.forEach(s=>{ s.movementPlan=null; resetWeaponShots(s); advanceGroundedState(s); });
  render(); renderPanel();
  setTimeout(()=>{
    aiDoMovement();
    resolveMovementCollisions();
    resolveTurretAiming(); // every ship's final position is known now: swing each turret onto its target
    render();
    const winner = checkWin();
    if(winner){ endGame(winner, winner==='player'?'victory':'defeat'); return; }
    playMovementAnimation(()=>finishMovementPhase());
  }, 300);
}

// "End Movement Phase": warns first if any ship has a turret target picked but never confirmed (its
// turret won't aim at it), then hands over to the enemy and plays the sweep.
function endMovementPhase(){
  if(state.phase!=='movement' || state.activeSide!=='player') return;
  const unconfirmed = state.fleets.player.filter(s=>!s.destroyed && s.aimTargetId && !s.targetConfirmed && s.turretWeapons.some(Boolean));
  const n = unconfirmed.length;
  if(n && !confirm(`${n} ship${n>1?'s have':' has'} a turret target selected but not confirmed — ${n>1?'their turrets':'its turret'} won't aim at it. End the Movement phase anyway?`)) return;
  advanceToAiMovement();
}

// The end of the Movement phase, once the sweep has played and every ship is at its final spot:
// torpedoes launched in the last Special Orders phase now strike, mine and torpedo impacts get
// their windows, and any sinkings are marked before the Firing phase begins.
function finishMovementPhase(){
  resolveTorpedoes();
  releasePendingEffects();
  purgeDestroyed();
  const winner = checkWin();
  if(winner){ endGame(winner, winner==='player'?'victory':'defeat'); return; }
  advanceToFiring();
}

// Plays back every ship's plotted movement for this round as a synchronized 2-second sweep,
// then calls back once it's done. Underlying ship positions are already final (set the moment
// each move was confirmed) — this only affects what gets drawn while it plays.
function playMovementAnimation(callback){
  const entries = state.roundMovePaths;
  state.roundMovePaths = [];
  const swinging = allShips().filter(s=>s.turretAnim && !s.destroyed);
  allShips().forEach(s=>{ if(s.destroyed) s.turretAnim = null; });
  if(entries.length===0 && swinging.length===0){ callback(); return; }
  const now = performance.now();
  const duration = 2000;
  state.sweepActive = true; // turret cones (and the "degrees off target" arrows) show for the whole sweep
  swinging.forEach(s=>{ s.turretAnim.startTime = now; });
  entries.forEach(entry=>{
    if(entry.ship.destroyed) return; // e.g. sailed off the map — nothing left to animate
    // The ship already has a pending moveAnim (set at confirm-time) holding it at its start
    // position — just start the clock on it now so every ship's sweep plays in sync.
    if(entry.ship.moveAnim){ entry.ship.moveAnim.startTime = now; }
    else { entry.ship.moveAnim = {points: entry.points, startTime: now, duration}; }
  });
  setTimeout(()=>{ state.sweepActive = false; callback(); }, duration);
}

function advanceToFiring(){
  state.phase='firing'; state.activeSide='player';
  state.firingCommenced = false;
  allShips().filter(s=>s.activeOrder==='full' && (s.destroyed || s.grounded)).forEach(s=>{ s.activeOrder = null; });
  // Fresh targeting queue for every living player ship — nothing queued, nothing confirmed yet.
  state.fleets.player.filter(s=>!s.destroyed).forEach(s=>{
    s.queuedFire = { broadsidePort: [], broadsideStarboard: [], turret: [], torpedo: [] };
    s.firingConfirmed = false;
  });
  updatePhaseBanner();
  pruneSelection();
  render(); renderPanel();
}

// "Skip Firing Phase": the player passes on firing this phase (any shots they had queued are dropped)
// and moves on to the Special Orders phase. The AI is not skipped — it still fires this phase, exactly as it
// does when a player confirms every ship with nothing queued — so the exchange plays out with an empty
// player volley, and we wait for those windows to finish before moving on.
function skipFiringPhase(){
  if(state.phase!=='firing' || state.activeSide!=='player' || state.firingCommenced) return;
  const anyQueued = state.fleets.player.some(s=>!s.destroyed && s.queuedFire && Object.values(s.queuedFire).some(a=>a.length));
  if(anyQueued && !confirm('Skip firing? The shots you have queued this phase will be discarded.')) return;
  state.fleets.player.filter(s=>!s.destroyed).forEach(s=>{
    s.queuedFire = { broadsidePort: [], broadsideStarboard: [], turret: [], torpedo: [] };
    s.firingConfirmed = true;
  });
  state.selectedShipIds.clear(); state.selectedShipId = null;
  commenceFiring();
  afterWindowsClear(()=>endFiringPhase());
}
// The max number of times a given weapon group's fire button can still be queued this turn —
// same "any weapon in the group still has ammo" rule the old instant-fire buttons used.
// Shots already spoken for by queued volleys: a turret volley at a front/rear-arc target uses two.
function volleysUsed(s, groupKey, queueArr){
  if(groupKey!=='turret') return queueArr.length;
  return queueArr.reduce((n,id)=>{ const t=shipById(id); return n + (t ? turretFireCost(s,t) : 1); }, 0);
}
function maxVolleysForGroup(s, groupKey){
  if(groupKey==='torpedo'){
    return Math.max(0, ...s.torpedoTubes.filter(t=>t.weapon).map(t=>t.shotsLeft), 0);
  }
  if(groupKey==='turret' && deadWater(s)) return 0;
  const arr = groupKey==='turret' ? s.turretWeapons : s[groupKey];
  return Math.max(0, ...arr.filter(Boolean).map(e=>e.shotsLeft), 0);
}
// Does this ship have at least one living enemy it could actually shoot right now: a weapon group with
// shots left, the enemy inside that weapon's range AND firing arc, and no island in the way?
function shipHasFireTarget(s){
  if(s.destroyed || s.activeOrder==='full') return false; // All Ahead Full: no shooting this phase
  const live = (arr)=> arr.filter(e=>e && e.shotsLeft>0);
  const deadTur = deadWater(s);
  const port = live(s.broadsidePort), stbd = live(s.broadsideStarboard), tur = deadTur ? [] : live(s.turretWeapons);
  if(!port.length && !stbd.length && !tur.length) return false;
  return state.fleets.ai.some(e=>{
    if(e.destroyed) return false;
    const d = dist(s.x,s.y,e.x,e.y);
    const bearing = bearingFromTo(s.x,s.y,e.x,e.y);
    const reach = (arr)=> arr.some(en=> WEAPONS[en.weapon].range >= d);
    const ok = (port.length && reach(port) && inBroadsideArc(s.heading, bearing, 'port'))
            || (stbd.length && reach(stbd) && inBroadsideArc(s.heading, bearing, 'starboard'))
            || (tur.length && reach(tur) && inTurretArc(s.turretFacing, bearing));
    return ok && !lineBlockedByIsland(s.x,s.y,e.x,e.y);
  });
}
// Which player ships have something to shoot at, and which of those haven't confirmed targeting yet.
// Ships with no available target never hold up Commence Firing.
function firingReadiness(){
  const eligible = state.fleets.player.filter(s=>!s.destroyed && shipHasFireTarget(s));
  // Ships on All Ahead Full make an extra move after the shooting; one that hasn't plotted it yet just holds course.
  const movers = state.fleets.player.filter(s=>!s.destroyed && s.activeOrder==='full');
  return { eligible, unconfirmed: eligible.filter(s=>!s.firingConfirmed), movers, unplotted: movers.filter(s=>!s.extraPlan) };
}
// "Commence Firing" button: if ships that do have a target in range haven't confirmed, ask first.
function commenceFiringClicked(){
  if(state.phase!=='firing' || state.activeSide!=='player' || state.firingCommenced) return;
  const {eligible, unconfirmed, movers, unplotted} = firingReadiness();
  if(!eligible.length && !movers.length) return;
  if(unconfirmed.length || unplotted.length){
    let msg = '';
    if(unconfirmed.length) msg += `${unconfirmed.length===1?'This ship has':'These ships have'} an enemy in range but ${unconfirmed.length===1?'has':'have'} not confirmed targeting:\n${unconfirmed.map(shipLabel).join(', ')}\n(Any volleys already queued will fire; the rest will hold fire.)\n\n`;
    if(unplotted.length) msg += `${unplotted.length===1?'This ship is':'These ships are'} on All Ahead Full but ${unplotted.length===1?'has':'have'} not plotted the extra move:\n${unplotted.map(shipLabel).join(', ')}\n(${unplotted.length===1?'It':'They'} will hold course at minimum speed.)\n\n`;
    msg += 'Commence firing anyway?';
    if(!confirm(msg)) return;
  }
  state.fleets.player.filter(s=>!s.destroyed).forEach(s=>{ s.firingConfirmed = true; });
  commenceFiring();
}
// Resolves every queued shot — the player's confirmed targeting AND the AI's own choices —
// together in one pass, before either side's sinkings are marked. Order doesn't advantage
// either side here since destruction isn't applied until endFiringPhase() runs afterward.
function commenceFiring(){
  if(state.firingCommenced) return;
  state.firingCommenced = true;
  // An All Ahead Full ship that never plotted its extra move holds course at minimum speed.
  state.fleets.player.filter(s=>!s.destroyed && s.activeOrder==='full' && !s.extraPlan).forEach(s=>{ s.extraPlan = defaultMoveDraft(s); });
  state.moveDraft = null;
  pendingGunShots = []; // resolveAttack() fills this as shots below actually resolve
  pendingEffects = []; // ...and this, held back until the firing-window batch (if any) closes
  state.fleets.player.filter(s=>!s.destroyed).forEach(s=>{
    const q = s.queuedFire;
    if(!q) return;
    q.broadsidePort.forEach(targetId=>{ const t=shipById(targetId); if(t) fireBroadside(s,'port',t); });
    q.broadsideStarboard.forEach(targetId=>{ const t=shipById(targetId); if(t) fireBroadside(s,'starboard',t); });
    q.turret.forEach(targetId=>{ const t=shipById(targetId); if(t) fireTurrets(s,t); });
  });
  aiDoFiring();
  flushFiringWindowBatch();
  if(!firingWindows.length) releasePendingEffects(); // nothing to wait for — show impacts now
  state.selectedShipIds.clear(); state.selectedShipId=null;
  updatePhaseBanner();
  render(); renderPanel();
}
// Turns everything resolveAttack() captured into pendingGunShots this pass into a scheduled
// batch of Firing Windows: window i opens at i*FIRING_WINDOW_STAGGER_MS, and once the LAST one
// has opened, every currently-open window starts its 2s animation together and closes together.
function flushFiringWindowBatch(){
  if(!pendingGunShots.length) return;
  const shots = pendingGunShots;
  pendingGunShots = [];
  // A batch is already on screen (say the player is launching ship by ship): don't cut it off or
  // orphan its windows — wait for it to finish, then play this one.
  if(firingWindows.length){ firingBatchQueue.push(shots); return; }
  startFiringBatch(shots);
}
function startFiringBatch(shots){
  firingBatchStartTime = performance.now();
  const n = shots.length;
  // If staggering every shot at the normal rate would push the last window's open time past
  // the 2s mark, compress the stagger so all N windows still finish opening evenly within
  // that first 2s (rather than the group's shared play/close getting pushed later and later
  // the more guns fired this round).
  const normalSpan = (n-1)*FIRING_WINDOW_STAGGER_MS;
  const effectiveStagger = (n>1 && normalSpan>FIRING_WINDOW_PLAY_MS) ? FIRING_WINDOW_PLAY_MS/(n-1) : FIRING_WINDOW_STAGGER_MS;
  firingWindows = shots.map((shot,i)=>({
    id: firingWindowNextId++,
    shooter: shot.shooter,
    weaponKey: shot.weaponKey,
    openDelay: i*effectiveStagger,
    opened: false,
    el: null
  }));
}
// Hit/miss splashes and explosions are held here until the firing-window batch finishes (or
// released immediately if there was no batch this pass — e.g. only Heavy Cannons/Torpedoes fired).
function releasePendingEffects(){
  const hitTargets = new Map(), missTargets = new Map();
  pendingEffects.forEach(e=>{
    if(e.type==='hitwindow'){
      // If a ship takes more than one hit this round, remember if ANY of them was a torpedo —
      // that's the clip it gets, even if gunfire also landed on it.
      const prevTorpedo = hitTargets.get(e.target.id)?.torpedo || false;
      hitTargets.set(e.target.id, {target:e.target, torpedo: prevTorpedo || e.weaponKey==='Torpedo'});
    } else if(e.type==='misswindow'){
      // Same idea for misses: if a ship is called out as a torpedo near-miss by even one entry,
      // it gets the dedicated torpedo-miss clip instead of a generic gunfire-miss one.
      const prevTorpedo = missTargets.get(e.target.id)?.torpedo || false;
      missTargets.set(e.target.id, {target:e.target, torpedo: prevTorpedo || e.weaponKey==='Torpedo'});
    } else {
      spawnEffect(e.type, e.x, e.y);
    }
  });
  pendingEffects = [];
  // A ship that was both hit and missed this round only gets the hit window — no redundant
  // second window for the same ship.
  const impacts = [
    ...[...hitTargets.values()].map(({target,torpedo})=>({target, kind: torpedo?'torpedoHit':'hit'})),
    ...[...missTargets.values()].filter(({target})=>!hitTargets.has(target.id)).map(({target,torpedo})=>({target, kind: torpedo?'torpedoMiss':'miss'}))
  ];
  if(impacts.length) flushHitWindowBatch(impacts);
}
// "End Firing Phase" — only reachable after Commence Firing has resolved the round's shots.
// This is where sinkings actually get marked (in advanceToSpecialOrders) and the game moves on
// to the Special Orders phase.
function endFiringPhase(){
  if(state.phase!=='firing' || state.activeSide!=='player' || !state.firingCommenced) return;
  state.activeSide='ai';
  state.selectedShipIds.clear(); state.selectedShipId=null; state.moveDraft=null;
  updatePhaseBanner();
  render(); renderPanel();
  const anyMovers = allShips().some(s=>!s.destroyed && s.activeOrder==='full');
  const go = ()=> executeExtraMoves(()=>{
    resolveCriticalDamage(); // all of the round's Critical Damage checks, together, at the end of the shooting
    render();
    // Every ship sunk this phase explodes at once (twice, 1 s each) before the Special Orders phase begins.
    const sinking = allShips().filter(s=>s.structureCur<=0);
    if(sinking.length){
      const t0 = performance.now()+150;
      sinking.forEach(s=>{ s.sinkFx = {t0}; });
      // After the two explosions: the ship is gone from the map, and a firing window plays the sinking clip beside where it was.
      setTimeout(()=>{
        sinking.forEach(s=>{ s.sinkFx = null; });
        purgeDestroyed();
        render();
        flushHitWindowBatch(sinking.map(s=>({target:s, kind:'sinking'})));
        afterWindowsClear(()=>advanceToSpecialOrders());
      }, 150 + SHIP_EXPLOSION.playMs*SHIP_EXPLOSION.plays + 100);
    } else setTimeout(()=>advanceToSpecialOrders(), 300);
  });
  if(anyMovers) afterWindowsClear(go); else go();
}
// All Ahead Full: with every shot of the Firing phase now rolled, the ships on that order make their extra moves.
// (A ship that was sunk by those shots does not move; the move is not changed by critical damage rolled afterwards.)
function aiPlanExtraMove(s){
  const minSpd = minSpeedFor(s);
  const foes = state.fleets.player.filter(e=>!e.destroyed);
  if(!foes.length) return {speed:minSpd, turns:[], minePlacedAtCum:null};
  let target = foes.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b);
  const bs = aiBtSteer(s);
  if(bs){ target = bs.target ? bs.target : {x:bs.x, y:bs.y}; }
  const turnAmt = Math.max(-s.turning, Math.min(s.turning, angDiff(bearingFromTo(s.x,s.y,target.x,target.y), s.heading)));
  const speed = Math.max(minSpd, s.movement);
  return aiPlanAvoidingHazards(s, turnAmt, speed, minSpd).plan;
}
function executeExtraMoves(cb){
  const movers = allShips().filter(s=>!s.destroyed && s.structureCur>0 && s.activeOrder==='full' && !s.grounded && !deadWater(s));
  if(!movers.length){ cb(); return; }
  state.roundMovePaths = [];
  movers.forEach(s=>{
    let plan = s.extraPlan || (s.side==='ai' ? aiPlanExtraMove(s) : defaultMoveDraft(s));
    s.extraPlan = null;   // the move is being made now: drop the plotted dashed path and silhouette, as in a normal Movement sweep
    plan = { speed: Math.max(minSpeedFor(s), Math.min(s.movement, plan.speed)), turns: plan.turns||[], minePlacedAtCum:null };
    const path = computePath(s, plan);
    state.roundMovePaths.push({ship:s, points:path.points});
    s.moveAnim = {points: path.points, startTime: null, duration: 2000};
    s.x = path.endX; s.y = path.endY; s.heading = path.endHeading;
    applyMomentum(s, path.totalDist);
    const oob = checkBoardBounds(s, path);
    const grounded = applyGroundingIfNeeded(s, path);
    if(!oob && !grounded) logMsg('sys', `${shipLabel(s)} makes its All Ahead Full move (${path.totalDist.toFixed(0)}").`);
  });
  resolveMovementCollisions();
  // Turrets settle for the new positions: a ship with a target swings toward it, any other turret turns with its hull.
  movers.filter(s=>!s.destroyed).forEach(s=>{
    if(s.side==='ai'){
      const foes = state.fleets.player.filter(e=>!e.destroyed);
      if(foes.length && s.turretWeapons.some(Boolean)){
        const t = foes.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b);
        s.aimTargetId = t.id; rotateTurretToward(s, t);
      }
    } else if(s.targetConfirmed){
      const t = shipById(s.aimTargetId);
      if(t && !t.destroyed && s.turretWeapons.some(Boolean)) rotateTurretToward(s, t);
      s.turretSyncHeading = s.heading;
    } else {
      settleTurretWithHull(s);
    }
  });
  checkMineDetonations();
  render();
  playMovementAnimation(()=>{
    state.fleets.player.forEach(s=>{ s.extraPlan = null; });
    releasePendingEffects();
    purgeDestroyed();
    cb();
  });
}

function purgeDestroyed(){
  [...state.fleets.player, ...state.fleets.ai].forEach(s=>{
    if(s.structureCur<=0 && !s.destroyed){
      s.destroyed=true;
      logMsg('dmg', `${shipLabel(s)} (${s.side==='player'?'yours':'enemy'}) is destroyed!`);
    }
  });
  // A target that has sunk can't be aimed at any more: drop it, so its red line goes away and the player picks a new one.
  state.fleets.player.forEach(s=>{
    const t = s.aimTargetId && shipById(s.aimTargetId);
    if(t && t.destroyed){ s.aimTargetId = null; s.targetConfirmed = false; }
  });
}
// A ship that strays off the edge of the board is lost — sailed out of the battle entirely.
function checkBoardBounds(s, path){
  if(s.destroyed) return false;
  if(s.x<0 || s.x>BOARD_W || s.y<0 || s.y>BOARD_H){
    if(btActive() && s.side===btAttackerSide() && btExitsThroughGate(s, path)){
      btExtractShip(s, 'sails off the board through the Exit gate');
      return true;
    }
    s.destroyed = true;
    s.structureCur = 0;
    logMsg('dmg', `${shipLabel(s)} strays beyond the edge of the map and is lost, with all hands!`);
    return true;
  }
  return false;
}
// Islands: a ship whose plotted path enters one stops dead there, takes hull damage, and is
// stuck (grounded) until it's re-floated a couple of turns later.
function applyGroundingIfNeeded(s, path){
  if(!path.islandHit || s.destroyed) return false;
  const dmg = Math.round(s.structureMax/3);
  s.structureCur = Math.max(0, s.structureCur - dmg);
  s.grounded = { contact:{x:path.endX, y:path.endY}, islandCenter:{x:path.islandHit.cx, y:path.islandHit.cy}, phase:'frozen' };
  spawnEffect('explosion', path.endX, path.endY);
  logMsg('dmg', `${shipLabel(s)} runs aground! The hull takes ${dmg} damage and the ship is stuck fast — it'll need a re-floating action to get moving again.`);
  return true;
}
function checkWin(){
  if(btActive()) return btCheckWin();
  if(kothActive()) return kothCheckWin();
  const pAlive = state.fleets.player.some(s=>!s.destroyed);
  const aAlive = state.fleets.ai.some(s=>!s.destroyed);
  if(!pAlive) return 'ai';
  if(!aAlive) return 'player';
  return null;
}
function endGame(winner, reason){
  state.gameOver=true;
  state.gameOverWinner = winner;
  state.gameOverReason = reason || (winner==='player' ? 'victory' : 'defeat');
  reason = state.gameOverReason;
  const msg = reason==='surrender' ? 'You have surrendered the battle.'
    : (((btActive()||kothActive()) && state.btEndNote) ? state.btEndNote : (winner==='player' ? 'VICTORY! The enemy fleet is annihilated.' : 'DEFEAT. Your fleet has been destroyed.'));
  logMsg('sys', msg);
  updatePhaseBanner();
  clearCritPopups();
  document.getElementById('shipActionBox').classList.remove('show');
  showSummary(winner, reason);
}

/* ============================== END-OF-BATTLE SUMMARY ============================== */
function relevantWeaponKeys(s){
  const set = new Set([
    ...s.broadsidePort.map(e=>e?e.weapon:null),
    ...s.broadsideStarboard.map(e=>e?e.weapon:null),
    ...s.turretWeapons.map(e=>e?e.weapon:null),
    ...s.torpedoTubes.map(t=>t.weapon)
  ].filter(Boolean));
  if(s.hasMine) set.add('Mine');
  return [...set];
}

function shipSummaryHTML(s){
  const keys = relevantWeaponKeys(s);
  const rows = keys.map(k=>{
    const st = s.weaponStats[k] || {fired:0,hits:0,damage:0};
    const pct = st.fired ? Math.round(100*st.hits/st.fired) : 0;
    return `<tr><td>${k}</td><td>${st.fired}</td><td>${st.hits}</td><td>${pct}%</td><td>${st.damage}</td></tr>`;
  }).join('');
  return `<div class="summaryShip ${(s.destroyed && !s.extracted)?'destroyedRow':''}">
    <div class="summaryShipHead row" style="justify-content:space-between;">
      <span><b>${s.isVip?'<span style="color:#ffd84a">★</span> ':''}${shipLabel(s)}</b> <span class="smallDim">${s.type}${s.extracted?' — EXTRACTED':(s.destroyed?' — DESTROYED':'')}</span></span>
      <span class="smallDim">Distance moved: ${Math.round(s.distanceMoved||0)}"</span>
    </div>
    <table class="summaryTable"><thead><tr><th>Weapon</th><th>Fired</th><th>Hits</th><th>Hit%</th><th>Damage</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="smallDim">No weapons fired</td></tr>'}</tbody></table>
  </div>`;
}

function shipHealthHTML(s){
  const arcRow = (label,arc)=>{
    const shieldPct = arc==='stern' ? 0 : 100*s.shields[arc]/s.shieldsMax;
    const armorMax = SHIP_TYPES[s.type].armor[arc];
    const armorPct = 100*s.armor[arc]/armorMax;
    return `<div class="barRow"><span class="lbl">${label}</span>
      <div class="barTrack" title="Shields"><div class="barFill shieldFill" style="width:${shieldPct}%"></div></div>
      <span class="smallDim" style="width:34px;">${arc==='stern'?'—':s.shields[arc]}</span>
      <div class="barTrack" title="Armor"><div class="barFill armorFill" style="width:${armorPct}%"></div></div>
      <span class="smallDim" style="width:34px;">${s.armor[arc]}/${armorMax}</span></div>`;
  };
  return `<div class="summaryShip">
    <div class="summaryShipHead row" style="justify-content:space-between;">
      <span><b>${shipLabel(s)}</b> <span class="smallDim">${s.type}</span></span>
      <span class="smallDim">Structure: ${s.structureCur}/${s.structureMax}</span>
    </div>
    ${arcRow('Prow','prow')}
    ${arcRow('Stbd','starboard')}
    ${arcRow('Port','port')}
    ${arcRow('Stern','stern')}
  </div>`;
}

function showSummary(winner, reason){
  const title = reason==='surrender'
    ? (winner==='player' ? 'Enemy Surrendered — Victory!' : 'You Surrendered')
    : (winner==='player' ? 'Victory!' : 'Defeat');
  const titleColor = winner==='player' ? 'var(--good)' : 'var(--bad)';
  const winningFleet = winner==='player' ? state.fleets.player : state.fleets.ai;
  const survivors = winningFleet.filter(s=>!s.destroyed || s.extracted);
  const survivorSection = survivors.length ? `
    <h3 style="color:var(--good);">Surviving Fleet — Final Condition</h3>
    ${survivors.map(shipHealthHTML).join('')}` : '';
  let btBlock = '';
  if(btActive() && reason!=='surrender'){
    const r = btResult();
    btBlock = `<div class="summaryShip"><div class="summaryShipHead"><b style="color:#ffd84a">★ Breakthrough result</b> <span class="smallDim">${r.ex} of ${r.vips.length} VIP${r.vips.length>1?'s':''} extracted — ${r.need} needed</span></div>
      ${r.vips.map(v=>`<div style="font-size:12px;">★ ${shipLabel(v)} <span class="smallDim">${v.type}</span> — ${v.extracted?'<span style="color:var(--good)">extracted</span>':(v.destroyed?'<span style="color:var(--bad)">lost</span>':'still afloat')}</div>`).join('')}</div>`;
  }
  if(kothActive() && reason!=='surrender'){
    const k = state.bt.score;
    btBlock = `<div class="summaryShip"><div class="summaryShipHead"><b style="color:#ffd84a">♛ King of the Hill result</b> <span class="smallDim">You ${k.player} — ${k.ai} Enemy · target ${state.bt.target} · ${Math.min(state.round,state.bt.rounds)} of ${state.bt.rounds} rounds</span></div></div>`;
  }
  let html = `<h1 style="color:${titleColor};text-align:center;">${title}</h1>
    ${btBlock}
    ${survivorSection}
    <h3 style="color:var(--accent);">Your Fleet</h3>
    ${state.fleets.player.map(shipSummaryHTML).join('')}
    <h3 style="color:var(--accent2);">Enemy Fleet</h3>
    ${state.fleets.ai.map(shipSummaryHTML).join('')}
    <div class="row" style="justify-content:center;margin-top:8px;">
      <button class="primary" id="summaryCloseBtn">Return to Main Menu</button>
    </div>`;
  document.getElementById('summaryBody').innerHTML = html;
  document.getElementById('summaryModal').classList.add('show');
  document.getElementById('summaryCloseBtn').onclick = resetToMainMenu;
}

function resetToMainMenu(){
  battleMusic.pause(); battleMusic.currentTime = 0;
  document.getElementById('summaryModal').classList.remove('show');
  document.getElementById('app').style.display='none';
  showMainMenu();
  document.getElementById('log').innerHTML='';
  state.fleets = { player:[], ai:[] };
  state.headingPlayer=null; state.headingAI=null;
  state.sunDeg=0; state.round=1; state.phase='movement'; state.activeSide='player';
  state.selectedShipIds.clear(); state.selectedShipId=null; state.mines=[]; state.torpedoes=[]; state.gameOver=false; pendingCrits=[]; clearCritPopups();
  state.moveDraft=null; state.aimDraft=null; state.fireLog=[];
  state.zoom=1; state.viewCenter={x:BOARD_W/2,y:BOARD_H/2};
  state.boxManualPos=null;
  state.statBoxOpenedOnce=false;
  state.effects=[];
  state.islands=[];
  state.bt=null; state.btEndNote=null; state.deployDrag=null; state.skirmishType='annihilation'; setBoardSize(1200,800);
  document.getElementById('deployTray').classList.remove('show');
  document.getElementById('skirmishTypeScreen').style.display='none';
  state.refloatDrag=null;
  state.moveTargetDrag=null;
  state.refloatRotateDrag=null;
  state.sweepActive=false;
  state.firingCommenced=false;
  firingWindows.forEach(w=>{ if(w.el) w.el.remove(); });
  firingWindows=[]; pendingGunShots=[]; pendingEffects=[]; firingBatchStartTime=null; firingBatchQueue=[];
  hitWindows.forEach(w=>{ if(w.el) w.el.remove(); });
  hitWindows=[]; hitBatchStartTime=null;
  closeMineInspector();
  fitSelectedShipId=null;
  fitSelection=null;
  document.getElementById('roundNo').textContent='1';
}

/* ============================== COMBAT RESOLUTION ============================== */
function rangeModifier(dist_, maxRange){
  if(dist_ <= maxRange*0.25) return 2;
  if(dist_ <= maxRange*0.5) return 1;
  if(dist_ > maxRange*0.75) return -1;
  return 0;
}
function sunModifier(bearingOfShot){
  const d = Math.abs(angDiff(bearingOfShot, state.sunDeg));
  return d<=15 ? -5 : 0;
}
// Applies one landed hit's damage: shields (unless the weapon ignores them or the ship is
// aground), then armor, then structure, on whichever facing the shot arrives from. Also queues the
// impact window and updates the shooter's stats. Shared by gunfire, mines, and torpedoes.
function applyHitDamage(weapon, target, bearingAttackerToTarget, weaponKey, shooter){
  const arc = arcOfBearing(target.heading, normDeg(bearingAttackerToTarget+180));
  let dmg = weapon.damage;
  let where = arc;
  // A grounded ship's shields are down — damage goes straight through to armor, same as a mine.
  if(!weapon.ignoresShields && !target.grounded && target.shields[arc]>0){
    const absorbed = Math.min(target.shields[arc], dmg);
    target.shields[arc]-=absorbed; dmg-=absorbed;
    where += ' shields';
  }
  if(dmg>0 && target.armor[arc]>0){
    const absorbed = Math.min(target.armor[arc], dmg);
    target.armor[arc]-=absorbed; dmg-=absorbed;
    where += (dmg>0?' + armor':' armor');
  }
  if(dmg>0){
    target.structureCur = Math.max(0, target.structureCur-dmg);
    where += ' + STRUCTURE';
    recordStructureHit(target, weaponKey); // Critical Damage check, rolled at the end of the Firing phase
  }
  pendingEffects.push({type:'hitwindow', target, weaponKey});
  if(shooter && weaponKey){
    const st = shooter.weaponStats[weaponKey] || (shooter.weaponStats[weaponKey] = {fired:0,hits:0,damage:0});
    st.hits++;
    st.damage += weapon.damage;
  }
  return {arc, where};
}
function resolveAttack(weapon, target, bearingAttackerToTarget, dist_, weaponName, weaponKey, shooter){
  if(shooter && weaponKey){
    const st = shooter.weaponStats[weaponKey] || (shooter.weaponStats[weaponKey] = {fired:0,hits:0,damage:0});
    st.fired++;
  }
  if(FIRING_WINDOW_WEAPONS[weaponKey] && shooter){ pendingGunShots.push({shooter, weaponKey}); }
  if(weapon.range && dist_ > weapon.range){
    logMsg('miss', `${weaponName} — target out of range.`);
    pendingEffects.push({type:'misswindow', target});
    return false;
  }
  const roll = 1+Math.floor(Math.random()*20);
  const rMod = weapon.range ? rangeModifier(dist_, weapon.range) : 0;
  const sMod = sunModifier(bearingAttackerToTarget);
  const gMod = target.grounded ? 5 : 0; // aground and exposed — much easier to hit
  // A ship under Full Reverse Stop is slow and easy to hit: +3 against it from guns (not mines).
  const fMod = (target.activeOrder==='reverse' && weaponKey!=='Mine' && weaponKey!=='Torpedo') ? 3 : 0;
  const total = roll + rMod + sMod + gMod + fMod;
  // Rule: hit if (roll + range/sun/grounded modifiers) exceeds the FIRING ship's Gunnery stat.
  const isHit = total > weapon.gunnery;
  if(!isHit){
    logMsg('miss', `${weaponName} misses (roll ${roll}${rMod>=0?'+':''}${rMod}${sMod?sMod:''}${gMod?'+'+gMod:''}${fMod?'+'+fMod+' (full reverse)':''} = ${total} vs Gunnery ${weapon.gunnery}).`);
    pendingEffects.push({type:'misswindow', target});
    return false;
  }
  const {arc, where} = applyHitDamage(weapon, target, bearingAttackerToTarget, weaponKey, shooter);
  logMsg('hit', `${weaponName} HITS ${shipLabel(target)} on the ${arc} (${where}) for ${weapon.damage} dmg. (roll ${total}${target.grounded?' — aground, shields down':''} vs Gunnery ${weapon.gunnery})`);
  return true;
}

function fireBroadside(ship, side, target){
  const weapons = side==='port' ? ship.broadsidePort : ship.broadsideStarboard;
  if(weapons.every(e=>!e)){ logMsg('miss', `${shipLabel(ship)} has no weapons fitted on that broadside.`); return; }
  if(weapons.every(e=>!e || e.shotsLeft<=0)){ logMsg('miss', `${shipLabel(ship)} broadside (${side}) is out of shots for this turn.`); return; }
  const bearing = bearingFromTo(ship.x,ship.y,target.x,target.y);
  if(!inBroadsideArc(ship.heading, bearing, side)){ logMsg('miss', `${shipLabel(ship)} broadside (${side}) has no target in arc.`); return; }
  const blockingIsland = lineBlockedByIsland(ship.x,ship.y,target.x,target.y);
  if(blockingIsland){ logMsg('miss', `${shipLabel(ship)} broadside (${side}) — an island blocks the line of sight to ${shipLabel(target)}.`); return; }
  const d = dist(ship.x,ship.y,target.x,target.y);
  weapons.forEach(entry=>{
    if(!entry || entry.shotsLeft<=0) return; // empty mount, or already out of shots this turn
    entry.shotsLeft--;
    const w = WEAPONS[entry.weapon];
    resolveAttack({range:w.range, damage:w.damage, gunnery:ship.gunnery}, target, bearing, d, entry.weapon+' ('+side+')', entry.weapon, ship);
  });
}
// Turret fire straight ahead or straight astern is awkward: if the target is in the firing ship's front (prow)
// or rear (stern) arc, the ship can only make HALF its turret shots. Implemented as a shot costing double there:
// each mount fires once but spends two of its shots (an odd last shot is simply used up).
function turretFireCost(ship, target){
  const arc = arcOfBearing(ship.heading, bearingFromTo(ship.x, ship.y, target.x, target.y));
  return (arc==='prow' || arc==='stern') ? 2 : 1;
}
function fireTurrets(ship, target){
  if(deadWater(ship)){ logMsg('miss', `${shipLabel(ship)} is dead in the water: its turrets cannot fire.`); return; }
  if(ship.turretWeapons.every(e=>!e)){ logMsg('miss', `${shipLabel(ship)} has no turret weapons fitted.`); return; }
  if(ship.turretWeapons.every(e=>!e || e.shotsLeft<=0)){ logMsg('miss', `${shipLabel(ship)} turrets are out of shots for this turn.`); return; }
  const bearing = bearingFromTo(ship.x,ship.y,target.x,target.y);
  if(!inTurretArc(ship.turretFacing, bearing)) { logMsg('miss', `${shipLabel(ship)} turrets have no target in arc.`); return; }
  const blockingIsland = lineBlockedByIsland(ship.x,ship.y,target.x,target.y);
  if(blockingIsland){ logMsg('miss', `${shipLabel(ship)} turrets — an island blocks the line of sight to ${shipLabel(target)}.`); return; }
  const d = dist(ship.x,ship.y,target.x,target.y);
  const cost = turretFireCost(ship, target);
  if(cost>1) logMsg('sys', `${shipLabel(ship)} is firing its turrets at a target in its ${arcOfBearing(ship.heading, bearing)==='prow'?'front':'rear'} arc: half rate (each volley uses up two shots per mount).`);
  ship.turretWeapons.forEach((entry,i)=>{
    if(!entry || entry.shotsLeft<=0) return;
    entry.shotsLeft = Math.max(0, entry.shotsLeft - cost);
    const w = WEAPONS[entry.weapon];
    resolveAttack({range:w.range, damage:w.damage, gunnery:ship.gunnery}, target, bearing, d, entry.weapon+' turret #'+(i+1), entry.weapon, ship);
  });
}
/* ============================== SPECIAL ORDERS PHASE: TORPEDOES, MINES & COURSE ADJUSTMENT ============================== */
let nextTorpedoId = 1;
// A lane is {x, y, heading, halfWidth, range}: where it was launched from, which way it points, the
// cone's half-angle (degrees) and how far it runs. These helpers work in the lane's own coordinates:
// "along" = distance ahead of the launch point, "across" = sideways from the centre line (+ = starboard).
function torpedoLaneLocal(tp, x, y){
  const dx = x-tp.x, dy = y-tp.y, rad = tp.heading*DEG2RAD;
  return { along: dx*Math.sin(rad) - dy*Math.cos(rad), across: dx*Math.cos(rad) + dy*Math.sin(rad) };
}
// How far either side of the centre line the lane reaches, `along` inches out: it grows at the cone angle
// until it hits the width cap (about 123" out for a 7° cone and a 15" cap), then stays that wide.
function torpedoLaneHalfWidthAt(tp, along){
  const cap = tp.maxHalfWidth!=null ? tp.maxHalfWidth : TORPEDO_LANE_MAX_HALF;
  return Math.min(Math.max(0, along)*Math.tan(tp.halfWidth*DEG2RAD), cap);
}
// The lane's outline (in lane coordinates): a point at the ship, widening to the cap, then straight on to full range.
function torpedoLaneOutline(tp){
  const tan = Math.tan(tp.halfWidth*DEG2RAD);
  const cap = tp.maxHalfWidth!=null ? tp.maxHalfWidth : TORPEDO_LANE_MAX_HALF;
  const L = tp.range;
  const a1 = (L*tan <= cap) ? L : cap/tan;               // where the cone reaches the cap
  const wa = Math.min(a1*tan, cap), wL = Math.min(L*tan, cap);
  return [{along:0,across:0},{along:a1,across:wa},{along:L,across:wL},{along:L,across:-wL},{along:a1,across:-wa}];
}
// The same outline as world coordinates (for drawing).
function torpedoLaneWorldOutline(tp){
  const rad = tp.heading*DEG2RAD, fx=Math.sin(rad), fy=-Math.cos(rad), rx=Math.cos(rad), ry=Math.sin(rad);
  return torpedoLaneOutline(tp).map(q=>({x: tp.x + q.along*fx + q.across*rx, y: tp.y + q.along*fy + q.across*ry}));
}
// True if point (x,y) sits inside the torpedo lane.
function torpedoLaneContains(tp, x, y){
  if(dist(tp.x,tp.y,x,y) < 0.5) return false;
  const {along, across} = torpedoLaneLocal(tp, x, y);
  if(along<=0 || along>tp.range) return false;
  return Math.abs(across) <= torpedoLaneHalfWidthAt(tp, along);
}
// The lane a ship would launch into if it fired right now.
function launchLaneOf(ship){
  return {x:ship.x, y:ship.y, heading:ship.heading, halfWidth:TORPEDO_ARC_HALF, range:WEAPONS.Torpedo.range};
}
// How far (in inches) a point sits outside a torpedo's lane — 0 if it is inside. Used for the "near
// miss" call-out: a ship within a few inches of the lane, even if never actually inside it, still gets
// a miss window. This is the true distance to the lane's outline, so it is right for every part of
// the shape (the cone, the straight sides, the far end, and behind the launch point).
function distanceToLane(tp, x, y){
  const {along, across} = torpedoLaneLocal(tp, x, y);
  if(along>=0 && along<=tp.range && Math.abs(across) <= torpedoLaneHalfWidthAt(tp, along)) return 0;
  const poly = torpedoLaneOutline(tp);
  let best = Infinity;
  for(let i=0;i<poly.length;i++){
    const a = poly[i], b = poly[(i+1)%poly.length];
    const abx = b.along-a.along, aby = b.across-a.across, len2 = abx*abx+aby*aby;
    let t = len2>0 ? ((along-a.along)*abx + (across-a.across)*aby)/len2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(along-(a.along+t*abx), across-(a.across+t*aby)));
  }
  return best;
}
// Chance a torpedo connects, by distance from where it was launched to the ship it runs into
// (measured at the end of the following movement phase): about 95% point-blank, falling in a
// straight line to 10% at full range — a ship nearer the launch is much more likely to be hit.
function torpedoHitChance(d, range){
  const frac = Math.max(0, Math.min(1, d/range));
  return 0.10 + 0.85*(1-frac);
}
// The ship a torpedo runs into: the CLOSEST ship of EITHER side (other than the launcher) that is
// inside its lane, with no island in the way. Fire-and-forget: it doesn't care whose ship it is.
function torpedoTargetFor(tp){
  let best = null, bestD = Infinity;
  allShips().forEach(sh=>{
    if(sh.id===tp.ownerId) return;
    if(!torpedoLaneContains(tp, sh.x, sh.y)) return;
    if(lineBlockedByIsland(tp.x,tp.y,sh.x,sh.y)) return;
    const d = dist(tp.x,tp.y,sh.x,sh.y);
    if(d<bestD){ best=sh; bestD=d; }
  });
  return best ? {ship:best, d:bestD} : null;
}
function readyTorpedoTubes(ship){
  return ship.torpedoTubes.filter(t=>t.weapon && t.shotsLeft>0);
}
// Special Attack order: launch one torpedo from every ready tube. Nothing is aimed or rolled now —
// each torpedo just remembers where it was launched from and the lane it was launched into, and
// is resolved at the end of the next Movement phase (see resolveTorpedoes).
// Every torpedo a ship could still launch this phase: one entry per available shot (a ready tube has
// up to two). The Special Orders panel shows one button per entry when this order is chosen.
function torpedoLaunchSlots(ship){
  const slots = [];
  ship.torpedoTubes.forEach((t,ti)=>{
    if(!t.weapon) return;
    for(let k=0;k<t.shotsLeft;k++) slots.push({key:`${ti}:${k}`, tube:ti, shot:k});
  });
  return slots;
}
// Launches torpedoes from a ship. With `keys` (slot keys from torpedoLaunchSlots) it launches exactly those
// torpedoes; without, one from every ready tube (what the AI does). Nothing is aimed or rolled now — each
// torpedo just remembers where it was launched from and the lane it was launched into, and is resolved at
// the end of the next Movement phase (see resolveTorpedoes). Records ONE launch Firing Window for the
// ship, however many torpedoes it fired — the caller flushes the window batch.
function launchTorpedoes(ship, keys=null){
  if(ship.destroyed) return 0;
  const picks = keys
    ? keys.map(k=>+String(k).split(':')[0])
    : ship.torpedoTubes.map((t,i)=>i).filter(i=>{ const t=ship.torpedoTubes[i]; return t.weapon && t.shotsLeft>0; });
  let launched = 0;
  // Every other living ship's position at this exact instant — used later to tell who was in or
  // near the lane WHEN the torpedo was fired (as opposed to only at resolution time).
  const launchSnapshot = allShips().filter(sh=>sh.id!==ship.id && !sh.destroyed).map(sh=>({id:sh.id, x:sh.x, y:sh.y}));
  picks.forEach(ti=>{
    const t = ship.torpedoTubes[ti];
    if(!t || !t.weapon || t.shotsLeft<=0) return; // spent (or now reloading) since it was selected
    t.shotsLeft--;
    const w = WEAPONS[t.weapon];
    state.torpedoes.push({ id: nextTorpedoId++, ownerId: ship.id, side: ship.side,
      x: ship.x, y: ship.y, heading: ship.heading,
      halfWidth: TORPEDO_ARC_HALF, range: w.range, damage: w.damage, weaponKey: t.weapon,
      launchSnapshot });
    const st = ship.weaponStats[t.weapon] || (ship.weaponStats[t.weapon] = {fired:0,hits:0,damage:0});
    st.fired++;
    launched++;
  });
  if(!launched) return 0;
  pendingGunShots.push({shooter: ship, weaponKey:'Torpedo'});
  logMsg('sys', `${shipLabel(ship)} launches ${launched} torpedo${launched>1?'es':''} down its torpedo lane — they strike at the end of the next Movement phase.`);
  return launched;
}
// Resolves every in-flight torpedo at the end of a Movement phase (after the sweep has played, so
// every ship is at its final position). Each one is judged against the lane it was launched
// into, not against wherever its launcher has since moved: a ship that has sailed out of the
// lane is safe; the closest ship still in it is the one in danger.
function resolveTorpedoes(){
  const flying = state.torpedoes;
  state.torpedoes = [];
  flying.forEach(tp=>{
    const owner = shipById(tp.ownerId);
    const ownerName = owner ? shipLabel(owner) : 'A ship';
    const hit = torpedoTargetFor(tp);
    let hitShipId = null;
    if(hit){
      const chance = torpedoHitChance(hit.d, tp.range);
      const roll = Math.random();
      const pct = Math.round(chance*100);
      if(roll < chance){
        hitShipId = hit.ship.id;
        const {arc, where} = applyHitDamage({damage:tp.damage}, hit.ship, bearingFromTo(tp.x,tp.y,hit.ship.x,hit.ship.y), tp.weaponKey, owner);
        logMsg('hit', `${ownerName}'s torpedo HITS ${shipLabel(hit.ship)}${hit.ship.side===tp.side?' (friendly fire!)':''} on the ${arc} (${where}) for ${tp.damage} dmg. (${Math.round(hit.d)}" from launch — ${pct}% chance)`);
      } else {
        logMsg('miss', `${ownerName}'s torpedo runs past ${shipLabel(hit.ship)} and misses. (${Math.round(hit.d)}" from launch — only a ${pct}% chance)`);
      }
    } else {
      logMsg('miss', `${ownerName}'s torpedo runs its lane and finds nothing in its path.`);
    }
    // Near-miss call-out: every ship (other than the launcher and whichever ship this torpedo
    // actually hit, if any) that was ever within 5" of the lane — inside it or just outside —
    // either when the torpedo was fired or now, at the end of the following Movement phase, gets
    // its own "torpedo miss" Firing Window. A ship the torpedo could never have reached (an
    // island in the way at that position) doesn't count for that position.
    allShips().forEach(sh=>{
      if(sh.id===tp.ownerId || sh.destroyed || sh.id===hitShipId) return;
      const launchPos = tp.launchSnapshot && tp.launchSnapshot.find(p=>p.id===sh.id);
      const nearAtLaunch = launchPos && distanceToLane(tp,launchPos.x,launchPos.y)<=5 && !lineBlockedByIsland(tp.x,tp.y,launchPos.x,launchPos.y);
      const nearNow = distanceToLane(tp,sh.x,sh.y)<=5 && !lineBlockedByIsland(tp.x,tp.y,sh.x,sh.y);
      if(nearAtLaunch || nearNow){
        pendingEffects.push({type:'misswindow', target:sh, weaponKey:'Torpedo'});
      }
    });
  });
}
// Lay a mine just off the stern. One per ship per Special Orders phase.
// Where a mine laid by this ship would land: just off the stern (never buried in an island).
// Shared by layMine() and the AI's decision about whether laying one here is worthwhile.
function mineDropPoint(ship){
  const rad = ship.heading*DEG2RAD, back = ship.hullLen/2 + 3;
  let mx = Math.max(0, Math.min(BOARD_W, ship.x - Math.sin(rad)*back));
  let my = Math.max(0, Math.min(BOARD_H, ship.y + Math.cos(rad)*back));
  if(islandAt(mx,my)){ mx = ship.x; my = ship.y; }
  return {x:mx, y:my};
}
function layMine(ship){
  if(!ship.hasMine || ship.mineInv<=0 || ship.mineLaidThisPhase || ship.destroyed) return false;
  const {x:mx, y:my} = mineDropPoint(ship);
  state.mines.push({id: nextMineId++, x:mx, y:my, side:ship.side, shipId:ship.id});
  ship.mineInv--; ship.mineLaidThisPhase = true;
  pendingGunShots.push({shooter: ship, weaponKey:'Mine'}); // laying happens instantly, so this is queued for the caller to flush right away
  logMsg('sys', `${shipLabel(ship)} lays a mine.`);
  return true;
}
// The AI's Special Attack order: launch a salvo when the CLOSEST ship in its lane is an enemy (it won't
// fire into its own side), and occasionally seed a mine when an enemy is nearby.
// Where a ship is likely to be after its NEXT move: it keeps going the way it's facing, about as
// far as it went last phase (never less than half its top speed). Used by the AI to aim torpedoes
// at where a target is going rather than where it is, and to judge where a mine is worth laying.
function predictShipNextPos(sh){
  const step = sh.lastDistance!=null && sh.lastDistance>0 ? sh.lastDistance : sh.movement*0.5;
  const rad = sh.heading*DEG2RAD;
  return {x: sh.x + Math.sin(rad)*step, y: sh.y - Math.cos(rad)*step};
}
// The best torpedo shot this ship has right now, or null. A torpedo is resolved at the end of the
// NEXT movement phase, so the AI judges the lane against where each enemy is headed, not just
// where it sits: it wants a target whose predicted position is inside the lane (a speculative shot
// is allowed at one that is merely in the lane now), no island in the way, and no friendly ship
// closer in the lane to take the torpedo instead.
function aiBestTorpedoShot(s){
  const lane = launchLaneOf(s);
  let best = null;
  state.fleets.player.filter(e=>!e.destroyed).forEach(e=>{
    const dNow = dist(s.x,s.y,e.x,e.y);
    if(dNow > AI_TORPEDO_MAX_RANGE || lineBlockedByIsland(s.x,s.y,e.x,e.y)) return;     // too far for a decent chance, or no line
    const pp = predictShipNextPos(e);
    const inNext = torpedoLaneContains(lane, pp.x, pp.y);
    const inNow = torpedoLaneContains(lane, e.x, e.y);
    if(!inNext && !(inNow && Math.random()<0.35)) return;              // not where it's going — hold the shot
    const dShot = inNext ? dist(s.x,s.y,pp.x,pp.y) : dNow;
    const friendlyCloser = state.fleets.ai.some(f=>{
      if(f.id===s.id || f.destroyed) return false;
      const fp = predictShipNextPos(f);
      return (torpedoLaneContains(lane,f.x,f.y) && dist(s.x,s.y,f.x,f.y) <= dShot + 5) ||
             (torpedoLaneContains(lane,fp.x,fp.y) && dist(s.x,s.y,fp.x,fp.y) <= dShot + 5);
    });
    if(friendlyCloser) return;
    const score = torpedoHitChance(dShot, lane.range) * (inNext ? 1 : 0.5);
    if(!best || score>best.score) best = {target:e, score, dShot};
  });
  return best;
}
// Is laying a mine here worth it? Mines only go off when an enemy ENDS a move within range, so the
// AI lays one where an enemy is converging on its stern drop point (predicted to finish close to
// it), or is already right on top of it. Never stacks a new mine on top of one of its own.
function aiMineWorthwhile(s){
  const spot = mineDropPoint(s);
  if(state.mines.some(m=>m.side===s.side && dist(m.x,m.y,spot.x,spot.y) < 30)) return false;
  return state.fleets.player.filter(e=>!e.destroyed).some(e=>{
    const dNow = dist(e.x,e.y,spot.x,spot.y);
    if(dNow < 45) return Math.random() < 0.6;
    if(dNow > 160) return false;
    const pp = predictShipNextPos(e);
    const dPred = dist(pp.x,pp.y,spot.x,spot.y);
    return dPred < dNow && dPred <= 80 && Math.random() < 0.7;
  });
}
// The AI's Special Orders, ONE action per ship like the player: a torpedo salvo if it has a good
// shot, otherwise a mine if one is worthwhile, otherwise nothing. A ship that has just launched
// holds its next salvo back a round, so a squadron doesn't empty every tube every single turn.
function aiDoSpecialAttack(){
  const salvosAt = {}; // enemy id -> how many AI ships have already fired on it this phase
  state.fleets.ai.filter(s=>!s.destroyed && !deadWater(s)).forEach(s=>{
    if(readyTorpedoTubes(s).length && (s.aiLastTorpRound==null || state.round - s.aiLastTorpRound >= AI_TORPEDO_COOLDOWN_ROUNDS)){
      const shot = aiBestTorpedoShot(s);
      // Don't pile every ship's salvo onto one target — past a couple, it's overkill.
      if(shot && (salvosAt[shot.target.id]||0) < AI_MAX_SALVOS_PER_TARGET && Math.random() < 0.9){
        if(launchTorpedoes(s) > 0){ s.aiLastTorpRound = state.round; salvosAt[shot.target.id] = (salvosAt[shot.target.id]||0)+1; return; }
      }
    }
    if(s.hasMine && s.mineInv>0 && aiMineWorthwhile(s)){ layMine(s); return; }
    // Simple rules for the two movement orders. All Ahead Full when the enemy is far off (nothing to shoot at anyway);
    // Full Reverse Stop only rarely, and only for the tough big ships when an enemy is already close.
    const foes = state.fleets.player.filter(e=>!e.destroyed);
    if(foes.length && !s.crit && !s.grounded){
      const nd = Math.min(...foes.map(e=>dist(s.x,s.y,e.x,e.y)));
      if(btActive() && btRoleOf(s)==='attacker' && s.isVip){
        // VIPs sprint (All Ahead Full = an extra move) when no enemy is close, or whenever they are behind the schedule needed to beat the round limit.
        const gate = state.bt.gate, left = BT_ROUND_LIMIT - state.round;
        const toExit = Math.max(0, dist(s.x,s.y,gate.x,gate.y) - BT_EXIT_DEPTH);
        const behind = toExit > Math.max(1,left) * s.baseMovement * s.topSpeedMult * 0.9;
        if(nd>160 || behind) s.nextOrder = 'full';
      }
      else if(nd>300 && Math.random()<0.5) s.nextOrder = 'full';
      else if(nd<70 && s.structureMax>=30 && s.structureCur>=0.6*s.structureMax && Math.random()<0.15) s.nextOrder = 'reverse';
    }
  });
  flushFiringWindowBatch(); // every AI ship that launched or laid gets its window, staggered like any other batch
}
function advanceToSpecialOrders(){
  purgeDestroyed();
  btExtractionCheck();   // Breakthrough: attackers fully in the Exit Zone leave the battle now
  purgeDestroyed();
  kothScoreRound();      // King of the Hill: whoever holds the Hill scores
  let winner = checkWin();
  if(!winner) winner = kothEndCheck();
  if(!winner) winner = btRoundLimitReached();
  if(winner){ endGame(winner, winner==='player'?'victory':'defeat'); return; }
  state.phase='special'; state.activeSide='player';
  allShips().forEach(sh=>{
    sh.mineLaidThisPhase = false; sh.torpSelected = []; sh.torpConfirmed = false;
    sh.mineOrderConfirmed = false;   // this ship will lay a mine when the phase ends
    sh.specialOrderMode = null;      // null | 'torpedo' | 'mine' | 'course' — this ship's ONE choice for the phase
    sh.courseHeadingStart = sh.heading; // clamp baseline for Course Adjustment, fixed for the whole phase
    sh.courseAdjustHeading = null;   // live/pending heading while adjusting, applied to sh.heading on confirm
    sh.courseConfirmed = false;
    sh.flagOrderConfirmed = false;   // All Ahead Full / Full Reverse Stop confirmed for the coming round
    sh.activeOrder = null; sh.extraPlan = null; // this round's movement orders (and the +3 against a ship in reverse) end with its Firing phase
  });
  updatePhaseBanner();
  pruneSelection();
  render(); renderPanel();
}
// "End Special Orders Phase": every torpedo the player has CONFIRMED is launched now, along with the AI's
// own launches, as one volley of launch windows; once those have played the next round begins.
function endSpecialOrdersPhase(){
  if(state.phase!=='special' || state.activeSide!=='player') return;
  const unconfirmedTorps = state.fleets.player.filter(s=>!s.destroyed && (s.torpSelected||[]).length && !s.torpConfirmed);
  const unconfirmedCourse = state.fleets.player.filter(s=>!s.destroyed && s.specialOrderMode==='course' && !s.courseConfirmed);
  const unconfirmedFlag = state.fleets.player.filter(s=>!s.destroyed && (s.specialOrderMode==='full'||s.specialOrderMode==='reverse') && !s.flagOrderConfirmed);
  const nT = unconfirmedTorps.length, nC = unconfirmedCourse.length, nF = unconfirmedFlag.length;
  if(nT || nC || nF){
    const parts = [];
    if(nF) parts.push(`${nF} ship${nF>1?'s have':' has'} an All Ahead Full / Full Reverse Stop order not confirmed`);
    if(nT) parts.push(`${nT} ship${nT>1?'s have':' has'} torpedoes selected but not confirmed`);
    if(nC) parts.push(`${nC} ship${nC>1?'s have':' has'} a course adjustment not confirmed`);
    if(!confirm(`${parts.join('; ')} — they won't take effect. End the phase anyway?`)) return;
  }
  state.activeSide='ai';
  state.selectedShipIds.clear(); state.selectedShipId=null;
  updatePhaseBanner();
  render(); renderPanel();
  // Weapon shot counts and torpedo reload state are refreshed at the start of each side's next
  // turn (see beginRound / advanceToAiMovement) rather than here.
  setTimeout(()=>{
    state.fleets.player.filter(s=>!s.destroyed && s.torpConfirmed && (s.torpSelected||[]).length).forEach(s=>{
      launchTorpedoes(s, s.torpSelected);
    });
    state.fleets.player.filter(s=>!s.destroyed && s.mineOrderConfirmed).forEach(s=>{
      layMine(s);
    });
    // Confirmed All Ahead Full / Full Reverse Stop orders take effect when the next round begins.
    state.fleets.player.filter(s=>!s.destroyed && s.flagOrderConfirmed && (s.specialOrderMode==='full'||s.specialOrderMode==='reverse')).forEach(s=>{ s.nextOrder = s.specialOrderMode; });
    state.fleets.player.forEach(s=>{ s.torpSelected=[]; s.torpConfirmed=false; s.mineOrderConfirmed=false; s.specialOrderMode=null; s.courseAdjustHeading=null; s.courseConfirmed=false; s.flagOrderConfirmed=false; });
    aiDoSpecialAttack(); // adds the AI's launches/mines and flushes every window together with ours
    render();
    // Let the launch/mine windows finish before the round moves on.
    afterWindowsClear(()=>{ state.round++; beginRound(); });
  }, 300);
}
// Calls cb once no firing/impact windows are showing or queued (with a cap so a background tab,
// where animation frames pause, can never stall the game).
function afterWindowsClear(cb, maxWaitMs=10000){
  const t0 = performance.now();
  (function poll(){
    const busy = firingWindows.length || firingBatchQueue.length || hitWindows.length;
    if(!busy || performance.now()-t0 > maxWaitMs){ setTimeout(cb, 300); return; }
    setTimeout(poll, 100);
  })();
}

/* ============================== AI LOGIC ============================== */
// The AI's tactical heading (cross-the-T, closing distance, staying off the edge) has no idea
// islands exist — left alone it'll sail straight into one whenever the ideal heading happens to
// point through land. This searches the ship's actual turning range for the closest-to-ideal
// heading that doesn't hit an island, then (if the ship is genuinely boxed in) retries the same
// sweep at minimum speed, since a shorter path can sometimes clear a coastline a full-speed one
// can't. If nothing clears it, this falls back to the original tactically-ideal plan — a ship
// that's truly surrounded still needs SOME plan, matching the prior behavior in that edge case.
function aiPlanAvoidingIslands(s, desiredTurnAmt, speed, minSpd){
  const tryPlan = (turnAmt, spd)=>{
    const plan = { speed: spd, turns: Math.abs(turnAmt)>3 ? [{deg:turnAmt}] : [], minePlacedAtCum:null };
    return { plan, path: computePath(s, plan) };
  };
  const best = tryPlan(desiredTurnAmt, speed);
  if(!best.path.islandHit) return best;
  const candidates = [];
  for(let t=-s.turning; t<=s.turning+0.001; t+=10) candidates.push(t);
  candidates.sort((a,b)=> Math.abs(a-desiredTurnAmt) - Math.abs(b-desiredTurnAmt));
  for(const t of candidates){
    const c = tryPlan(t, speed);
    if(!c.path.islandHit) return c;
  }
  if(minSpd < speed){
    for(const t of candidates){
      const c = tryPlan(t, minSpd);
      if(!c.path.islandHit) return c;
    }
  }
  return best;
}
// Would a ship parked at (x,y) be inside the lane of any torpedo in flight (other than its own)?
function inTorpedoLane(ship, x, y){
  return state.torpedoes.some(tp=> tp.ownerId!==ship.id && torpedoLaneContains(tp, x, y));
}
// The AI's move planning, plus torpedo dodging: if the island-safe move would still leave the ship
// sitting in a torpedo lane at the end of the phase, look for the closest-to-intended heading
// (full speed first, then slowest) that clears both the coastline and every lane. Ships that
// sail out of a lane are safe from it, so this is what keeps the AI from being a sitting duck.
// Would this ship's candidate path run it into another ship during the sweep? Every ship moves at once, so each is
// judged at the same fractions of its own path (ships already planned this phase follow their plotted paths; the
// rest are treated as sitting where they are). Used so the AI doesn't blunder into its own fleet.
function aiPathHitsShip(s, path){
  let hitAt = Infinity;
  if(!path.points || path.points.length<2) return hitAt;
  const others = allShips().filter(o=>o!==s && !o.destroyed && o.structureCur>0).map(o=>{
    const e = state.roundMovePaths.find(en=>en.ship===o);
    if(e && e.points && e.points.length>1) return {o, pts:e.points};
    // An enemy-fleet ship that hasn't plotted yet is assumed to keep sailing straight at about its current speed.
    if(o.side==='ai' && state.aiPredictOn && !o.grounded && !o.movementPlan){
      state.aiPredict = state.aiPredict || {};
      if(!state.aiPredict[o.id]) state.aiPredict[o.id] = computePath(o, {speed: Math.min(o.movement, Math.max(minSpeedFor(o), o.lastDistance||0)), turns:[], minePlacedAtCum:null}).points;
      return {o, pts: state.aiPredict[o.id]};
    }
    return {o, pts:null};
  });
  const pose = (pts, o, tau)=>{ if(!pts) return {x:o.x,y:o.y,heading:o.heading}; const q = pts[pathIndexAt(pts,tau)]; return {x:q.x,y:q.y,heading:q.heading}; };
  const STEPS = 90, PAD = 1.5;
  const hull = (p,sh)=> hullCorners(p.x,p.y,p.heading, sh.hullLen*0.92+PAD, sh.hullWide*0.85+PAD);
  for(const {o,pts} of others){
    if(dist(s.x,s.y,o.x,o.y) > 400) continue;
    // already touching at the start (e.g. just rammed): not something this move is walking into
    if(hullsOverlap(hullCorners(path.points[0].x, path.points[0].y, path.points[0].heading, s.hullLen*0.92, s.hullWide*0.85), hullCorners(pose(pts,o,0).x, pose(pts,o,0).y, pose(pts,o,0).heading, o.hullLen*0.92, o.hullWide*0.85))) continue;
    for(let k=1;k<=STEPS;k++){
      const tau = k/STEPS;
      if(hullsOverlap(hull(pose(path.points,s,tau),s), hull(pose(pts,o,tau),o))){ hitAt = Math.min(hitAt, tau*path.totalDist); break; }
    }
  }
  return hitAt;   // distance sailed before the first contact (Infinity = clear)
}
// Looks one turn ahead: from where this move would end, a ship can never slow below half the distance it just
// covered, so would simply carrying straight on (at that minimum) take it into another ship's end position?
// Catches courses that are clear this turn but leave the ship boxed in against its neighbours next turn.
function aiDeadEndAhead(s, path){
  const ahead = 0.5*path.totalDist;
  if(ahead < 2) return false;
  const r = path.endHeading*DEG2RAD, fx = Math.sin(r), fy = -Math.cos(r);
  const PAD = 4;
  for(const o of allShips()){
    if(o===s || o.destroyed || o.structureCur<=0) continue;
    const e = state.roundMovePaths.find(en=>en.ship===o);
    let end = e && e.points && e.points.length ? e.points[e.points.length-1] : null;
    if(!end && o.side==='ai' && state.aiPredict && state.aiPredict[o.id]) end = state.aiPredict[o.id][state.aiPredict[o.id].length-1];
    const pose = end || {x:o.x, y:o.y, heading:o.heading};
    if(dist(path.endX,path.endY,pose.x,pose.y) > ahead + o.hullLen + s.hullLen + 10) continue;
    const B = hullCorners(pose.x,pose.y,pose.heading, o.hullLen*0.92+PAD, o.hullWide*0.85+PAD);
    for(let k=0;k<=8;k++){
      const f = ahead*k/8;
      if(hullsOverlap(hullCorners(path.endX+fx*f, path.endY+fy*f, path.endHeading, s.hullLen*0.92+PAD, s.hullWide*0.85+PAD), B)) return true;
    }
  }
  return false;
}
function aiPlanAvoidingHazards(s, desiredTurnAmt, speed, minSpd){
  const base = aiPlanAvoidingHazardsBase(s, desiredTurnAmt, speed, minSpd);
  if(aiPathHitsShip(s, base.path)===Infinity && !aiDeadEndAhead(s, base.path)) return base;
  // The tactical move would plough into another ship: look for the closest-to-intended course (full speed first, then
  // slower) that avoids ships, islands, enemy torpedo lanes and the board edge.
  const candidates = [];
  for(let t=-s.turning; t<=s.turning+0.001; t+=7.5) candidates.push(t);
  candidates.sort((a,b)=> Math.abs(a-desiredTurnAmt) - Math.abs(b-desiredTurnAmt));
  const speeds = [speed];
  [0.7, 0.45].forEach(f=>{ const v = Math.max(minSpd, speed*f); if(!speeds.some(x=>Math.abs(x-v)<1)) speeds.push(v); });
  if(!speeds.some(x=>Math.abs(x-minSpd)<1)) speeds.push(minSpd);
  const edge = 20;
  let bestHit = Infinity, bestPlan = null, clearOnly = null;
  for(const spd of speeds){
    for(const t of candidates){
      const plan = { speed: spd, turns: Math.abs(t)>3 ? [{deg:t}] : [], minePlacedAtCum:null };
      const path = computePath(s, plan);
      if(path.islandHit || inTorpedoLane(s, path.endX, path.endY)) continue;
      if(path.endX<edge || path.endX>BOARD_W-edge || path.endY<edge || path.endY>BOARD_H-edge) continue;
      const hit = aiPathHitsShip(s, path);
      if(hit===Infinity){
        if(!aiDeadEndAhead(s, path)) return {plan, path};
        if(!clearOnly) clearOnly = {plan, path};   // clear this turn but cramped next: use only if nothing roomier exists
        continue;
      }
      if(hit < bestHit){ bestHit = hit; bestPlan = {plan, path}; }
    }
  }
  if(clearOnly) return clearOnly;
  if(aiPathHitsShip(s, base.path)===Infinity) return base;
  // Boxed in: take the course that makes contact soonest and slowest, which does the least damage.
  return bestHit < aiPathHitsShip(s, base.path) ? bestPlan : base;
}
function aiPlanAvoidingHazardsBase(s, desiredTurnAmt, speed, minSpd){
  const base = aiPlanAvoidingIslands(s, desiredTurnAmt, speed, minSpd);
  if(!state.torpedoes.length || !inTorpedoLane(s, base.path.endX, base.path.endY)) return base;
  const tryPlan = (turnAmt, spd)=>{
    const plan = { speed: spd, turns: Math.abs(turnAmt)>3 ? [{deg:turnAmt}] : [], minePlacedAtCum:null };
    return { plan, path: computePath(s, plan) };
  };
  const candidates = [];
  for(let t=-s.turning; t<=s.turning+0.001; t+=10) candidates.push(t);
  candidates.sort((a,b)=> Math.abs(a-desiredTurnAmt) - Math.abs(b-desiredTurnAmt));
  for(const spd of (minSpd<speed ? [speed, minSpd] : [speed])){
    for(const t of candidates){
      const c = tryPlan(t, spd);
      if(!c.path.islandHit && !inTorpedoLane(s, c.path.endX, c.path.endY)) return c;
    }
  }
  return base; // nowhere safe to go — take the tactical move
}
// Looks across the ship's whole turning range for the move that ends with its bow pointed most
// squarely at where `target` is headed, and returns it only if that lines the target up well inside
// the torpedo lane. Skips any move that hits an island, sails into an enemy torpedo lane, rams the
// target, or leaves the board.
function aiPlanTorpedoAlignment(s, target, speed){
  const pp = predictShipNextPos(target);
  const range = WEAPONS.Torpedo.range;
  // Score one candidate turn: where would the target's predicted position sit in the lane the ship would
  // launch from at the end of that move? miss = sideways distance from the lane's centre line, as a
  // fraction of the lane's half-width there (0 = dead centre, 1 = right on the edge). The lane is only
  // 15" wide at long range, so this has to be judged in inches, not as an angle.
  const evalTurn = (t)=>{
    const plan = { speed, turns: Math.abs(t)>0.01 ? [{deg:t}] : [], minePlacedAtCum:null };
    const path = computePath(s, plan);
    if(path.islandHit || inTorpedoLane(s, path.endX, path.endY)) return null;
    if(path.endX<30 || path.endX>BOARD_W-30 || path.endY<30 || path.endY>BOARD_H-30) return null;
    if(dist(path.endX,path.endY,target.x,target.y) < 20) return null;
    const lane = {x:path.endX, y:path.endY, heading:path.endHeading, halfWidth:TORPEDO_ARC_HALF, range};
    const {along, across} = torpedoLaneLocal(lane, pp.x, pp.y);
    if(along<=0 || along>range) return null;
    return {plan, path, t, miss: Math.abs(across)/torpedoLaneHalfWidthAt(lane, along)};
  };
  let best = null;
  for(let t=-s.turning; t<=s.turning+0.001; t+=5){            // coarse sweep of the whole turning range...
    const c = evalTurn(t); if(c && (!best || c.miss<best.miss)) best = c;
  }
  if(!best) return null;
  for(let t=best.t-5; t<=best.t+5+0.001; t+=0.5){              // ...then fine steps around the best of them
    if(Math.abs(t) > s.turning+0.001) continue;
    const c = evalTurn(t); if(c && c.miss<best.miss) best = c;
  }
  return best.miss <= 0.6 ? {plan:best.plan, path:best.path} : null;
}
function aiDoMovement(){
  state.aiPredict = {}; state.aiPredictOn = true;
  // Big, slow ships plot first; the small, nimble ones then steer round them.
  const aiOrder = state.fleets.ai.filter(s=>!s.destroyed).sort((a,b)=>(RAM_SIZE[b.type]||2)-(RAM_SIZE[a.type]||2));
  aiOrder.forEach(s=>{
    if(s.grounded){
      if(s.grounded.phase==='ready'){
        // AI re-floats itself: pull away from the island it hit, not just a random direction —
        // along the bearing from the island's center through the contact point, extended out.
        const contact = s.grounded.contact;
        const center = s.grounded.islandCenter;
        const awayBearing = center ? bearingFromTo(center.x, center.y, contact.x, contact.y) : Math.random()*360;
        const d = 15+Math.random()*15; // 15"-30", within the 30" re-float allowance
        const rad = awayBearing*DEG2RAD;
        s.x = Math.max(0, Math.min(BOARD_W, contact.x + Math.sin(rad)*d));
        s.y = Math.max(0, Math.min(BOARD_H, contact.y - Math.cos(rad)*d));
        s.heading = awayBearing; // face away from the island, ready to keep moving clear of it
        s.grounded = null;
        s.lastDistance = 0;
        logMsg('sys', `${shipLabel(s)} works free and re-floats, pulling away from the island.`);
      }
      s.movementPlan = {speed:0, turns:[], minePlacedAtCum:null};
      return; // frozen, or just spent this turn re-floating — no ordinary movement this round
    }
    const enemies = state.fleets.player.filter(e=>!e.destroyed);
    if(enemies.length===0) return;
    // target nearest enemy
    let target = enemies.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b);
    const bsteer = aiBtSteer(s);   // Breakthrough: attackers run for the Exit Zone, defenders hunt the VIPs
    if(bsteer && bsteer.target) target = bsteer.target;
    const bearingToTarget = bearingFromTo(s.x,s.y,target.x,target.y);
    // Try to aim for a "cross the T": get heading perpendicular to target's heading
    const desiredHeading = normDeg(target.heading+90);
    let turnNeeded = angDiff(desiredHeading, s.heading);
    // also bias slightly toward closing distance if far away
    const d = dist(s.x,s.y,target.x,target.y);
    if(d>60){
      const closeBias = angDiff(bearingToTarget, s.heading);
      turnNeeded = turnNeeded*0.4 + closeBias*0.6;
    }
    let dGoal = d;
    if(bsteer && !bsteer.target){
      turnNeeded = angDiff(bearingFromTo(s.x,s.y,bsteer.x,bsteer.y), s.heading);
      dGoal = dist(s.x,s.y,bsteer.x,bsteer.y);
    }
    // Steer back toward open water near the edge of the board — a ship that sails off the map is lost.
    const edgeMargin = 45;
    if(!(bsteer && bsteer.goal==='exit') && (s.x<edgeMargin || s.x>BOARD_W-edgeMargin || s.y<edgeMargin || s.y>BOARD_H-edgeMargin)){
      const towardCenter = bearingFromTo(s.x,s.y,BOARD_W/2,BOARD_H/2);
      const edgeBias = angDiff(towardCenter, s.heading);
      turnNeeded = turnNeeded*0.25 + edgeBias*0.75;
    }
    const turnAmt = Math.max(-s.turning, Math.min(s.turning, turnNeeded));
    const minSpd = minSpeedFor(s);
    let speed = dGoal>15 ? s.movement : s.movement*0.5;
    if(bsteer && bsteer.goal==='exit') speed = s.movement;
    speed = Math.max(minSpd, Math.min(s.movement, speed)); // rule 4c: momentum floor/ceiling applies to the AI too
    // A ship with torpedoes ready that has an enemy in torpedo range tries to finish its move with its
    // bow pointed at where that enemy is HEADING, so the lane covers it at Special Orders. (The lane is
    // only 7 degrees wide, so without this the AI essentially never gets a shot.) It still stays clear
    // of islands and enemy torpedo lanes, and only does this some of the time so it isn't predictable.
    let aligned = null;
    if(!s.crit && readyTorpedoTubes(s).length && (s.aiLastTorpRound==null || state.round - s.aiLastTorpRound >= AI_TORPEDO_COOLDOWN_ROUNDS) && d>=50 && d<=AI_TORPEDO_MAX_RANGE-30 && Math.random()<AI_TORPEDO_AIM_CHANCE){
      aligned = aiPlanTorpedoAlignment(s, target, speed);
      if(aligned && aiPathHitsShip(s, aligned.path)!==Infinity) aligned = null; // not worth ramming a friend for
    }
    // A crippled ship can't steer where it wants: dead in the water it just coasts; with the helm jammed it still picks a speed but the turn is forced.
    const crippled = (s.crit || s.activeOrder==='reverse') ? critMovementPlan(s, {speed, turns:[{deg:turnAmt}], minePlacedAtCum:null}) : null;
    const {plan, path} = crippled ? {plan:crippled, path:computePath(s, crippled)} : (aligned || aiPlanAvoidingHazards(s, turnAmt, speed, minSpd));
    s.x=path.endX; s.y=path.endY; s.heading=path.endHeading;
    applyMomentum(s, path.totalDist);
    checkBoardBounds(s, path);
    applyGroundingIfNeeded(s, path); // AI ships must register as grounded too, or they just keep
                                      // re-colliding with the same coastline every turn instead of
                                      // ever entering the frozen/ready re-float state machine.
    state.roundMovePaths.push({ship:s, points:path.points});
    s.moveAnim = {points: path.points, startTime: null, duration: 2000}; // held until the sweep plays
    s.movementPlan=plan;
  });
  state.aiPredictOn = false; state.aiPredict = {};
  logMsg('sys', 'Enemy fleet maneuvers.');
  checkMineDetonations();
}
/* ============================== TURRET TARGETING (chosen during Movement) ============================== */
// Until one of your ships has a CONFIRMED target, its turret is stowed relative to the hull: the firing cone
// keeps its angle to the bow and turns with the ship whenever the ship turns (a course made in Movement, a
// Course Adjustment, or a re-float). Once a target is confirmed the turret is aimed in its own right: it stays
// fixed in the world as the hull turns, and swings toward the target. (Enemy ships always have a target.)
function turretFollowsHull(s){ return s.side==='player' && !s.targetConfirmed; }
function turretSyncOf(s){ return s.turretSyncHeading==null ? s.heading : s.turretSyncHeading; }
// Brings s.turretFacing up to date with the hull's current heading, then remembers that heading as the new baseline.
function settleTurretWithHull(s){
  if(turretFollowsHull(s)) s.turretFacing = normDeg(s.turretFacing + angDiff(s.heading, turretSyncOf(s)));
  s.turretSyncHeading = s.heading;
}
// A ship's turrets swing toward its confirmed target as the fleet moves, by up to the ship's Turret
// Traverse Speed per round. This runs once every ship's FINAL position for the round is known (after
// the AI has moved), settles the turret's new facing for game logic, and records the swing so the
// sweep can animate it. Returns the rotation applied (degrees, signed).
function rotateTurretToward(s, target){
  const diff = angDiff(bearingFromTo(s.x,s.y,target.x,target.y), s.turretFacing);
  const delta = Math.max(-s.turretTraverse, Math.min(s.turretTraverse, diff));
  const from = s.turretFacing;
  s.turretFacing = normDeg(from + delta);
  if(Math.abs(delta) > 0.01 && s.turretWeapons.some(Boolean)) s.turretAnim = {from, delta, startTime:null, duration:2000};
  return delta;
}
function resolveTurretAiming(){
  // The AI picks the nearest enemy (judged from where everyone has ended up) and swings onto it.
  const players = state.fleets.player.filter(e=>!e.destroyed);
  state.fleets.ai.filter(s=>!s.destroyed && !deadWater(s)).forEach(s=>{
    if(!players.length) return;
    let target = players.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b);
    if(btActive() && btRoleOf(s)==='defender'){   // a defender shoots a VIP whenever one is in reach
      const reach = btMaxRange(s), vs = players.filter(e=>e.isVip && dist(s.x,s.y,e.x,e.y)<=reach);
      if(vs.length) target = vs.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b);
    }
    s.aimTargetId = target.id;
    if(s.turretWeapons.some(Boolean)) rotateTurretToward(s, target);
  });
  // Player ships swing onto whatever target they've confirmed; the rest simply turn with their hulls.
  state.fleets.player.filter(s=>!s.destroyed && !deadWater(s)).forEach(s=>{
    if(s.targetConfirmed){
      const t = shipById(s.aimTargetId);
      if(!t || t.destroyed){ s.aimTargetId = null; s.targetConfirmed = false; settleTurretWithHull(s); return; }
      if(s.turretWeapons.some(Boolean)) rotateTurretToward(s, t);
      s.turretSyncHeading = s.heading;
    } else {
      settleTurretWithHull(s);
    }
  });
}
function aiDoFiring(){
  // Note: no purgeDestroyed() here — sinkings from this round's fire aren't marked until
  // endFiringPhase() runs, so a ship reduced to 0 structure by an earlier shot in this same
  // simultaneous volley is still a valid target for whatever else was aimed at it.
  state.fleets.ai.filter(s=>!s.destroyed && s.activeOrder!=='full').forEach(s=>{
    let target = shipById(s.aimTargetId);
    if(!target || target.destroyed){
      // Its target went down after the turrets swung (say, to a torpedo at the end of movement): fall back to the nearest survivor.
      const alive = state.fleets.player.filter(e=>!e.destroyed);
      if(!alive.length) return;
      target = alive.reduce((a,b)=> dist(s.x,s.y,a.x,a.y)<dist(s.x,s.y,b.x,b.y)?a:b);
      s.aimTargetId = target.id;
    }
    const d = dist(s.x,s.y,target.x,target.y);
    // Only fire a weapon group when it actually has a mount in range — no point wasting a
    // shot (or popping a Firing Window) on a target the AI could never hit from here.
    const inRange = (weapons)=> weapons.some(e=> e && e.shotsLeft>0 && WEAPONS[e.weapon].range >= d);
    if(inRange(s.broadsidePort)) fireBroadside(s,'port',target);
    if(inRange(s.broadsideStarboard)) fireBroadside(s,'starboard',target);
    if(!deadWater(s) && inRange(s.turretWeapons)) fireTurrets(s,target);
    // (Torpedoes are no longer fired here — they launch as a Special Attack order in the Special Orders phase; see aiDoSpecialAttack.)
  });
}

/* ============================== FLOATING SHIP ACTION BOX ============================== */
// What a ship has already finished this phase (shown as a tick in the fleet list).
function shipPhaseDone(s){
  if(state.phase==='movement') return !!s.movementPlan;
  if(state.phase==='firing') return s.activeOrder==='full' ? !!s.extraPlan : !!s.firingConfirmed;
  if(state.phase==='special') return !!(s.torpConfirmed || s.mineOrderConfirmed || s.courseConfirmed || s.flagOrderConfirmed);
  return false;
}
function shipListHeadHTML(s, open){
  const done = shipPhaseDone(s);
  const chips = [];
  if(s.isVip) chips.push(`<span class="chip" style="color:#ffd84a;border-color:#ffd84a;">★ VIP</span>`);
  if(s.crit) chips.push(`<span class="chip warn">${s.crit.kind==='dead'?'dead in water':'helm jammed'}</span>`);
  if(s.grounded) chips.push(`<span class="chip warn">aground</span>`);
  if(s.activeOrder==='full') chips.push(`<span class="chip warn">all ahead full</span>`);
  if(s.activeOrder==='reverse') chips.push(`<span class="chip warn">full reverse</span>`);
  if(done) chips.push(`<span class="chip done">&#10003;</span>`);
  return `<div class="shipListHead" data-ship="${s.id}" title="${open?'Click to close':'Click to open this ship\'s orders'}">
    <span class="caret">${open?'&#9662;':'&#9656;'}</span>
    <span class="nm">${shipLabel(s)}</span>
    <span class="meta">${s.type} &middot; ${Math.round(s.structureCur)}/${s.structureMax}</span>
    ${chips.join('')}
  </div>`;
}
// The draggable window is a stacked list of every ship you command. Opening one expands its full stat card and
// orders in place; only one ship is open at a time, and while one is open the map can't be used to switch ships.
// Buttons in the stat window that show/hide this ship's turret, broadside and torpedo firing arcs on the map (independently).
function arcTogglesHTML(s){
  const kinds = [];
  if(s.turretWeapons.some(Boolean)) kinds.push(['turret','Turret']);
  if(s.broadsidePort.some(Boolean) || s.broadsideStarboard.some(Boolean)) kinds.push(['broadside','Broadside']);
  if(s.torpedoTubes.some(t=>t.weapon)) kinds.push(['torpedo','Torpedo']);
  if(!kinds.length) return '';
  const on = s.arcShow || {};
  return `<div class="card arcToggles"><div class="smallDim" style="margin-bottom:4px;">Firing Arcs</div><div class="row" style="gap:6px;">${kinds.map(([k,l])=>`<button class="arcToggleBtn${on[k]?' on':''}" data-arc="${k}" style="flex:1;" title="Show or hide this ship's ${l.toLowerCase()} arc">${l}: ${on[k]?'on':'off'}</button>`).join('')}</div></div>`;
}
function renderPanel(){
  updatePhaseBanner();
  const box = document.getElementById('shipActionBox');
  if(state.phase==='deploy'){ box.classList.remove('show'); return; }
  if(state.gameOver || state.activeSide!=='player'){
    box.classList.remove('show');
    return;
  }
  const ships = state.fleets.player.filter(sh=>!sh.destroyed);
  if(!ships.length){ box.classList.remove('show'); return; }
  let open = state.selectedShipId ? shipById(state.selectedShipId) : null;
  if(open && (open.side!=='player' || open.destroyed)){ state.selectedShipIds.clear(); state.selectedShipId=null; open = null; }
  let html = `<div class="floatBoxHandle" id="floatBoxHandle" title="Drag to move">⠿⠿⠿ your fleet ⠿⠿⠿</div>`;
  ships.forEach(sh=>{
    const isOpen = !!open && sh.id===open.id;
    html += `<div class="shipListRow${isOpen?' open':''}">${shipListHeadHTML(sh, isOpen)}`;
    if(isOpen){
      html += `<div class="shipListBody">`;
      if(SHIP_SPRITES[sh.type]){
        html += `<div class="shipSpriteBox"><canvas id="shipSpriteCanvas" width="220" height="156" style="image-rendering:pixelated;"></canvas></div>`;
      }
      html += fullStatCardHTML(sh);
      html += arcTogglesHTML(sh);
      if(state.phase==='movement'){
        html += movementOrdersHTML(sh);
      } else if(state.phase==='firing'){
        html += sh.activeOrder==='full' ? extraMoveOrdersHTML(sh) : firingOrdersHTML(sh);
      } else if(state.phase==='special'){
        html += specialOrdersHTML(sh);
      }
      html += `</div>`;
    }
    html += `</div>`;
  });
  box.innerHTML = html;
  box.classList.add('show');
  box.querySelectorAll('.shipListHead').forEach(h=>{
    h.onclick = ()=> toggleShipOpen(h.dataset.ship);
  });
  if(open) wireUpPanel(open);
  box.querySelectorAll('.arcToggleBtn').forEach(b=>{
    b.onclick = ()=>{
      if(!open) return;
      open.arcShow = open.arcShow || {};
      open.arcShow[b.dataset.arc] = !open.arcShow[b.dataset.arc];
      renderPanel(); render();
    };
  });
  wireBoxDrag();
  positionFloatingBox();
}
// Opens a ship's window from the fleet list (closing whichever was open), or closes it if it is already open.
function toggleShipOpen(id){
  if(state.selectedShipId===id){
    state.selectedShipIds.clear(); state.selectedShipId=null; state.moveDraft=null;
    renderPanel(); render();
    return;
  }
  selectShip(id);
}

let boxDrag = null;
function wireBoxDrag(){
  const handle = document.getElementById('floatBoxHandle');
  if(!handle) return;
  handle.addEventListener('mousedown', (e)=>{
    e.preventDefault();
    e.stopPropagation();
    const box = document.getElementById('shipActionBox');
    const wrapRect = document.getElementById('canvasWrap').getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    boxDrag = { offsetX: e.clientX-boxRect.left, offsetY: e.clientY-boxRect.top, wrapRect };
  });
}
window.addEventListener('mousemove', (e)=>{
  if(!boxDrag) return;
  const box = document.getElementById('shipActionBox');
  const wrap = document.getElementById('canvasWrap');
  let left = e.clientX - boxDrag.wrapRect.left - boxDrag.offsetX;
  let top = e.clientY - boxDrag.wrapRect.top - boxDrag.offsetY;
  const boxW = box.offsetWidth, boxH = box.offsetHeight;
  left = Math.max(4, Math.min(wrap.clientWidth-boxW-4, left));
  top = Math.max(4, Math.min(wrap.clientHeight-boxH-4, top));
  state.boxManualPos = {left, top};
  box.style.left = left+'px';
  box.style.top = top+'px';
});
window.addEventListener('mouseup', ()=>{ boxDrag=null; });

function positionFloatingBox(){
  const box = document.getElementById('shipActionBox');
  if(!box.classList.contains('show')) return;
  const s = state.selectedShipId ? shipById(state.selectedShipId) : null;
  const wrap = document.getElementById('canvasWrap');
  const boxW = box.offsetWidth || 300, boxH = box.offsetHeight || 200;
  const pad = 10;
  let left, top;
  if(!state.boxManualPos && !state.statBoxOpenedOnce){
    // First time this box opens all game, default to the upper-left rather than next to the
    // ship — set as if manually placed there, so it stays put (not just for this one frame)
    // until the player actually drags it or a normal manual position gets set some other way.
    state.boxManualPos = {left: pad, top: pad};
    state.statBoxOpenedOnce = true;
  }
  if(state.boxManualPos){
    left = state.boxManualPos.left;
    top = state.boxManualPos.top;
  } else if(s){
    const p = worldToScreen(s.x, s.y);
    left = p.x + 26;
    top = p.y - boxH/2;
    if(left + boxW > wrap.clientWidth - pad) left = p.x - boxW - 26;
  } else {
    left = pad; top = pad;
  }
  if(left < pad) left = pad;
  if(left + boxW > wrap.clientWidth - pad) left = Math.max(pad, wrap.clientWidth - boxW - pad);
  if(top < pad) top = pad;
  if(top + boxH > wrap.clientHeight - pad) top = Math.max(pad, wrap.clientHeight - boxH - pad);
  box.style.left = left+'px';
  box.style.top = top+'px';
}

function fullStatCardHTML(s){
  const arcRow = (label,arc)=>{
    const shieldVal = (arc==='stern' || s.grounded) ? 0 : s.shields[arc];
    const shieldPct = arc==='stern' ? 0 : 100*shieldVal/s.shieldsMax;
    const armorMax = SHIP_TYPES[s.type].armor[arc];
    const armorPct = 100*s.armor[arc]/armorMax;
    return `<div class="barRow"><span class="lbl">${label}</span>
      <div class="barTrack" title="Shields"><div class="barFill shieldFill" style="width:${shieldPct}%"></div></div>
      <span class="smallDim" style="width:34px;">${arc==='stern'?'—':shieldVal}</span>
      <div class="barTrack" title="Armor"><div class="barFill armorFill" style="width:${armorPct}%"></div></div>
      <span class="smallDim" style="width:34px;">${s.armor[arc]}/${armorMax}</span></div>`;
  };
  const tubes = s.torpedoTubes.map(t=>{
    if(!t.weapon) return '—';
    if(t.reloading) return '⟳';
    return t.shotsLeft>0 ? '●'.repeat(t.shotsLeft) : '○';
  }).join(' ');
  return `<div class="card">
    <div class="row" style="justify-content:space-between;">
      <b style="color:var(--gold);">${shipLabel(s)}</b> <span class="smallDim">${s.type}</span>
      <span class="smallDim">Gunnery ${s.gunnery} · Turret trav ${s.turretTraverse}°/phase</span>
    </div>
    ${s.grounded ? '<div style="color:var(--bad);font-weight:600;font-size:11px;margin:2px 0;">⚠ Aground — shields down, +5 to enemy rolls to hit</div>' : ''}
    <div class="smallDim" style="margin:4px 0 2px;">Shields / Armor by arc:</div>
    ${arcRow('Prow','prow')}
    ${arcRow('Stbd','starboard')}
    ${arcRow('Port','port')}
    ${arcRow('Stern','stern')}
    <div class="barRow"><span class="lbl">Struct</span><div class="barTrack"><div class="barFill structFill" style="width:${100*s.structureCur/s.structureMax}%"></div></div><span class="smallDim">${s.structureCur}/${s.structureMax}</span></div>
    <div class="smallDim" style="margin-top:4px;">Torpedo tubes: ${tubes} &nbsp; ${s.hasMine ? `· Mines left: ${s.mineInv}` : ''}</div>
  </div>`;
}

// Can this (selected) ship be given a turret target right now? Player ship, alive, turrets fitted, and
// not already locked onto one (it has to be edited first).
function canPickTurretTarget(sel){
  return !!sel && !deadWater(sel) && sel.side==='player' && !sel.destroyed && !sel.targetConfirmed && sel.turretWeapons.some(Boolean);
}
// The "Turret Target" card in the Movement stat window: pick an enemy, Confirm Target (then Edit Target
// to change it). Once confirmed the turret cone swings onto that ship as the fleet moves.
function targetOrdersHTML(s){
  if(deadWater(s) && s.turretWeapons.some(Boolean)){
    return `<div class="card">
      <h3 style="margin:2px 0;color:#ff8a5c;">Turret Target</h3>
      <div class="smallDim" style="color:#ff9a6c;">&#9888; Dead in the water: the turret is frozen and cannot aim or fire. Broadside guns still work.</div>
    </div>`;
  }
  if(!s.turretWeapons.some(Boolean)){
    return `<div class="card">
      <h3 style="margin:2px 0;color:var(--gold);">Turret Target</h3>
      <div class="smallDim">No turrets fitted — nothing to aim. (Broadside guns need no aiming.)</div>
    </div>`;
  }
  const enemies = state.fleets.ai.filter(e=>!e.destroyed);
  const cur = enemies.some(e=>e.id===s.aimTargetId) ? s.aimTargetId : '';
  const confirmed = !!s.targetConfirmed && !!cur;
  const tgt = cur ? shipById(cur) : null;
  return `<div class="card">
    <h3 style="margin:2px 0;color:var(--gold);">Turret Target</h3>
    ${confirmed ? `<div class="smallDim">Locked on <b>${shipLabel(tgt)}</b>.</div>` : ''}
    <div class="row">
      <label>Target: </label>
      <select id="targetSel" ${confirmed?'disabled':''}>
        <option value="">— none —</option>
        ${enemies.map(e=>`<option value="${e.id}" ${cur===e.id?'selected':''}>${shipLabelTyped(e)} (${Math.round(dist(s.x,s.y,e.x,e.y))}")</option>`).join('')}
      </select>
    </div>
    <div class="row">${confirmed
      ? `<button id="editTargetBtn" style="width:100%;">Edit Target</button>`
      : `<button id="confirmTargetBtn" class="primary" style="width:100%;" ${cur?'':'disabled'}>Confirm Target</button>`}</div>
  </div>`;
}
/* ---- Critical Damage pop-ups ----
   When a ship suffers a Critical Damage Hit, a small text box pops up beside it showing the Critical Damage Card:
   the rolls, what is wrong, what it means for the ship's orders, and how repairs work. It stays until it is
   closed with its X (or until the next Movement phase begins), and follows the ship as the map is panned or zoomed. */
const critPopups = [];   // {id, shipId, el}
let nextCritPopupId = 1;
function critPopupHTML(s, info){
  const own = s.side==='player';
  const who = `${shipLabel(s)} <span style="font-weight:400;color:#9db0c4;">(${own?'yours':'enemy'})</span>`;
  const rolls = info.lines.map(l=>{
    const need = l.needs>1 ? l.needs+'+' : 'any roll';
    return `Structure hit, armor ${l.pct}%: D20 ${l.d20} (needs ${need}) &rarr; ` + (l.crit ? `<b style="color:#ff8a5c;">CRITICAL</b>, D6 ${l.d6}` : 'no critical');
  }).join('<br>') + (info.d2!=null ? `<br>D2 ${info.d2} &rarr; stuck turning ${info.d2===1?'left':'right'}` : '');
  let result, body, timing = '';
  if(info.kind==='explosion'){
    result = 'CATASTROPHIC EXPLOSION';
    body = `${own?'This ship is':'It is'} destroyed.`;
  } else if(info.kind==='dead'){
    result = 'DEAD IN THE WATER';
    body = own
      ? 'Engines and helm are out. In the Movement phase this ship cannot be given movement or turning orders: it coasts straight ahead at its minimum momentum speed.'
      : 'Its engines and helm are out. In the Movement phase it cannot steer: it coasts straight ahead at its minimum momentum speed.';
    if(info.note) body += ' ' + info.note;
  } else {
    const side = s.crit && s.crit.dir<0 ? 'left (to port)' : 'right (to starboard)';
    result = 'STEERING JAMMED';
    body = own
      ? `The helm is jammed hard ${side}. In the Movement phase this ship turns at its full ${s.turning}° that way, starting at once (no minimum turn distance). You can still set its speed.`
      : `Its helm is jammed hard ${side}. In the Movement phase it turns at its full ${s.turning}° that way, starting at once.`;
  }
  if(info.kind!=='explosion'){
    timing = 'This takes effect for the whole of the next Movement phase. A repair roll (D2, a 2 fixes it) is made at the start of the Movement phase after that, and again each Movement phase until it works.';
  }
  return `<div class="cpHead"><span class="cpTag">&#9888; CRITICAL DAMAGE HIT</span><button class="cpClose" title="Close">&times;</button></div>
    <div class="cpShip">${who}</div>
    <div class="cpRolls">${rolls}</div>
    <div class="cpResult">${result}</div>
    <div class="cpBody">${body}</div>
    ${timing ? `<div class="cpTime">${timing}</div>` : ''}`;
}
function showCritPopup(s, info){
  const el = document.createElement('div');
  el.className = 'critPopup';
  el.innerHTML = critPopupHTML(s, info);
  const id = nextCritPopupId++;
  el.dataset.popupId = id; el.dataset.shipId = s.id;
  el.querySelector('.cpClose').onclick = ()=>closeCritPopup(id);
  document.getElementById('firingWindowsLayer').appendChild(el);
  critPopups.push({id, shipId:s.id, el});
  updateCritPopups();
}
function closeCritPopup(id){
  const i = critPopups.findIndex(p=>p.id===id);
  if(i<0) return;
  critPopups[i].el.remove(); critPopups.splice(i,1);
}
function clearCritPopups(){
  critPopups.forEach(p=>p.el.remove()); critPopups.length = 0;
}
// Beside its ship (on whichever side has room), clamped on screen, and stacked so two pop-ups never overlap.
function updateCritPopups(){
  if(!critPopups.length) return;
  const wrap = document.getElementById('canvasWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const placed = [];
  critPopups.forEach(p=>{
    const sh = shipById(p.shipId); if(!sh) return;
    const dp = getDrawPos(sh), a = worldToScreen(dp.x, dp.y);
    const w = p.el.offsetWidth, h = p.el.offsetHeight;
    let x = a.x + 24;
    if(x + w > W - 4) x = a.x - 24 - w;
    x = Math.max(4, Math.min(x, W - w - 4));
    let y = Math.max(4, Math.min(a.y - h/2, H - h - 4));
    for(let tries=0; tries<14; tries++){
      const hit = placed.find(r=> x < r.x+r.w+6 && x+w+6 > r.x && y < r.y+r.h+6 && y+h+6 > r.y);
      if(!hit) break;
      y = hit.y + hit.h + 8;
      if(y + h > H - 4){ y = 4; x = Math.min(W - w - 4, x + w + 10); }   // out of room below: start a new column
    }
    p.el.style.left = x+'px'; p.el.style.top = y+'px';
    placed.push({x, y, w, h});
  });
}
function movementOrdersHTML(s){
  return targetOrdersHTML(s) + movementCardHTML(s);
}
function movementCardHTML(s){
  if(s.grounded){
    if(s.grounded.phase==='frozen'){
      return `<div class="card">
        <h3 style="margin:2px 0;color:var(--bad);">Aground!</h3>
      </div>`;
    }
    return refloatOrdersHTML(s);
  }
  if(s.crit && s.crit.kind==='dead' && s.movementPlan){
    return `<div class="card">
      <h3 style="margin:2px 0;color:#ff8a5c;">Dead in the Water</h3>
    </div>`;
  }
  if(s.movementPlan){
    return `<div class="card">
      <h3 style="margin:2px 0;color:var(--good);">Movement Confirmed</h3>
    </div>`;
  }
  const minSpd = Math.round(minSpeedFor(s));
  const maxSpd = Math.round(s.movement);
  const speedCap = Math.round(s.baseMovement*s.topSpeedMult);
  if(!state.moveDraft) state.moveDraft = defaultMoveDraft(s);
  const d = state.moveDraft;
  if(d.speed < minSpd) d.speed = minSpd;
  if(d.speed > maxSpd) d.speed = maxSpd;
  const preview = computePath(s, d);
  const turnDesc = d.turns.length ? `turning ${Math.abs(d.turns[0].deg)}° to ${d.turns[0].deg>0?'starboard':'port'}` : 'holding heading';
  return `<div class="card">
    <h3 style="margin:2px 0;color:var(--gold);">Movement Orders</h3>
    ${s.crit && s.crit.kind==='steering' ? `<div class="smallDim" style="color:#ff9a6c;">&#9888; Helm jammed ${s.crit.dir<0?'to port (left)':'to starboard (right)'}</div>` : ''}
    <div class="smallDim">Momentum this turn: min ${minSpd}" &middot; max ${maxSpd}" (overall cap ${speedCap}").</div>
    <div class="card" style="background:#031018;margin:6px 0;">
      <b style="color:var(--accent);">${d.speed}"</b> <span class="smallDim">${turnDesc}</span>
      ${preview.islandHit ? '<div style="color:var(--bad);font-weight:600;margin-top:3px;">⚠ Runs aground at this course!</div>' : ''}
    </div>
  </div>
  <div id="confirmBtnRow" class="row"><button class="primary" id="confirmMoveBtn">Confirm Movement</button></div>`;
}

function refloatOrdersHTML(s){
  if(!s.refloatPending) s.refloatPending = {x:s.grounded.contact.x, y:s.grounded.contact.y};
  if(s.refloatHeading==null) s.refloatHeading = s.heading;
  return `<div class="card">
    <h3 style="margin:2px 0;color:var(--gold);">Re-floating Action</h3>
    <div class="row"><span class="lbl">Heading</span>
      <input type="range" id="refloatHeadingSlider" min="0" max="359" value="${Math.round(s.refloatHeading)}" style="flex:1">
      <b id="refloatHeadingVal">${Math.round(s.refloatHeading)}</b>&deg;</div>
    <div class="row"><button class="primary" id="confirmRefloatBtn">Confirm Re-float</button></div>
  </div>`;
}

// Circle-row indicator: filled = shot still available this turn, empty = already spent.
function shotCirclesHTML(entries){
  return entries.map(entry=>{
    if(!entry) return `<span class="shotGroup empty" title="Empty mount">—</span>`;
    const max = WEAPONS[entry.weapon].shotsPerTurn;
    let dots = '';
    for(let i=0;i<max;i++){ dots += i<entry.shotsLeft ? '●' : '○'; }
    return `<span class="shotGroup" title="${entry.weapon}: ${entry.shotsLeft}/${max} shots left this turn">${dots}</span>`;
  }).join(' ');
}
function torpedoShotCirclesHTML(tubes){
  return tubes.map(t=>{
    if(!t.weapon) return `<span class="shotGroup empty" title="Empty mount">—</span>`;
    const max = WEAPONS[t.weapon].shotsPerTurn;
    const reloading = t.shotsReloading||0;
    let dots = '';
    for(let i=0;i<max;i++){ dots += i<t.shotsLeft ? '●' : (i<t.shotsLeft+reloading ? '⟳' : '○'); }
    // Only paint the whole pip group in the "spent" color when NOTHING in this tube is ready —
    // a partially-reloaded tube keeps the normal color so its still-available shot doesn't read as spent.
    const cls = (reloading>0 && t.shotsLeft===0) ? 'shotGroup reloading' : 'shotGroup';
    return `<span class="${cls}" title="${t.weapon}: ${t.shotsLeft}/${max} ready${reloading?`, ${reloading} reloading`:''}">${dots}</span>`;
  }).join(' ');
}

// The Special Orders panel for a ship: first a choice of exactly ONE action for the phase —
// Torpedo Attack, Lay Mine, or Course Adjustment — then that mode's own controls once chosen.
// A ship is "done" for the phase once torpConfirmed (torpedo), mineOrderConfirmed (mine), or
// courseConfirmed (course) is true. Whichever action is picked, nothing actually happens — no
// torpedoes launched, no mine placed, no animation played — until End Special Orders Phase is
// clicked (see endSpecialOrdersPhase()); this panel only ever stages a choice.
function specialOrdersHTML(s){
  if(deadWater(s)){
    return `<div class="card">
      <h3 style="margin:2px 0;color:#ff8a5c;">Special Orders</h3>
      <div class="smallDim" style="color:#ff9a6c;">&#9888; Dead in the water: this ship cannot issue any Special Orders until its engines are repaired.</div>
    </div>`;
  }
  if(!s.specialOrderMode){
    const half = Math.round(s.turning/2);
    const hasTubes = s.torpedoTubes.some(t=>t.weapon);
    return `<div class="card">
      <h3 style="margin:2px 0;color:var(--gold);">Special Orders</h3>
      <div class="smallDim">Pick ONE action for this ship this phase.</div>
      ${hasTubes ? `<div style="margin-top:10px;"><button id="chooseTorpedoBtn" class="primary" style="width:100%;">Torpedo Attack</button></div>
      <div class="smallDim">Launch one or more torpedoes down this ship's lane.</div>` : ''}
      ${s.hasMine ? `<div style="margin-top:10px;"><button id="chooseMineBtn" class="primary" style="width:100%;">Lay Mine</button></div>
      <div class="smallDim">Drop a mine astern.</div>` : ''}
      <div style="margin-top:10px;"><button id="chooseCourseBtn" style="width:100%;">Course Adjustment</button></div>
      <div class="smallDim">Rotate up to ${half}° either way, in place — no change to speed or position.</div>
      <div style="margin-top:10px;"><button id="chooseFullBtn" style="width:100%;" ${(s.crit||s.grounded)?'disabled':''}>All Ahead Full</button></div>
      <div class="smallDim">${(s.crit||s.grounded)?'Not available while crippled or aground.':'Next round: no shooting, but an extra move after everyone else\'s shots are resolved.'}</div>
      <div style="margin-top:10px;"><button id="chooseReverseBtn" style="width:100%;" ${s.grounded?'disabled':''}>Full Reverse Stop</button></div>
      <div class="smallDim">Next Movement phase: no move or turns, just a coast of 25% of its last move. +3 to hit it with guns that round.</div>
    </div>`;
  }
  if(s.specialOrderMode==='full' || s.specialOrderMode==='reverse'){
    const full = s.specialOrderMode==='full';
    const locked = !!s.flagOrderConfirmed;
    return `<div class="card">
      <h3 style="margin:2px 0;color:var(--gold);">${full?'All Ahead Full':'Full Reverse Stop'}</h3>
      <div class="smallDim">${full
        ? 'Next round this ship will not shoot. Instead it plots an extra move during the Firing phase, made only after every shot of the phase (including shots at this ship) has been rolled.'
        : 'Next Movement phase this ship makes no move and cannot turn: it just coasts forward 25% of the distance it last moved. Guns get +3 on their hit rolls against it that round (torpedoes and mines are unaffected).'}</div>
      ${locked
        ? `<div style="margin-top:8px;"><button id="cancelFlagOrderBtn" style="width:100%;">Cancel</button></div>
           <div class="smallDim" style="text-align:center;">Order confirmed — it takes effect next round.</div>`
        : `<div style="margin-top:8px;"><button id="confirmFlagOrderBtn" class="primary" style="width:100%;">Confirm Order</button></div>
           <div style="margin-top:6px;"><button id="backFromFlagBtn" style="width:100%;">← Back</button></div>`}
    </div>`;
  }
  if(s.specialOrderMode==='course'){
    const half = s.turning/2;
    const cur = s.courseAdjustHeading!=null ? s.courseAdjustHeading : s.courseHeadingStart;
    const delta = Math.round(angDiff(cur, s.courseHeadingStart));
    const locked = !!s.courseConfirmed;
    return `<div class="card">
      <h3 style="margin:2px 0;color:var(--gold);">Course Adjustment</h3>
      ${locked ? '' : `<div class="smallDim">Drag the gold handle out from the bow — up to ${half.toFixed(0)}° either side of the heading this ship started the phase with.</div>`}
      <div class="row" style="justify-content:space-between;margin-top:8px;">
        <span class="smallDim">New heading</span><b style="color:var(--gold);">${Math.round(normDeg(cur))}° (${delta>=0?'+':''}${delta}°)</b>
      </div>
      ${locked
        ? `<div style="margin-top:8px;"><button id="editCourseBtn" style="width:100%;">Edit Course</button></div>
           <div class="smallDim" style="text-align:center;">Course confirmed.</div>`
        : `<div style="margin-top:8px;"><button id="confirmCourseBtn" class="primary" style="width:100%;">Confirm Course</button></div>
           <div style="margin-top:6px;"><button id="backFromCourseBtn" style="width:100%;">← Back</button></div>`}
    </div>`;
  }
  if(s.specialOrderMode==='mine'){
    const locked = !!s.mineOrderConfirmed;
    return `<div class="card">
      <h3 style="margin:2px 0;color:var(--gold);">Lay Mine</h3>
      <div class="smallDim">Dropped astern; an enemy ship coming within 10" of it detonates it. Mines left: ${s.mineInv}.</div>
      ${locked
        ? `<div style="margin-top:8px;"><button id="cancelMineBtn" style="width:100%;">Cancel</button></div>
           <div class="smallDim" style="text-align:center;">Mine will be laid when the phase ends.</div>`
        : `<div style="margin-top:8px;"><button id="confirmMineBtn" class="primary" style="width:100%;" ${s.mineInv>0?'':'disabled'}>Lay Mine</button></div>
           <div style="margin-top:6px;"><button id="backFromMineBtn" style="width:100%;">← Back</button></div>`}
    </div>`;
  }
  // specialOrderMode==='torpedo'
  const slots = torpedoLaunchSlots(s);
  const sel = new Set(s.torpSelected || []);
  const locked = !!s.torpConfirmed;
  const nSel = slots.filter(sl=>sel.has(sl.key)).length;
  const lane = launchLaneOf(s);
  let enemiesIn = 0, friendsIn = 0;
  allShips().forEach(o=>{
    if(o.id===s.id || !torpedoLaneContains(lane,o.x,o.y) || lineBlockedByIsland(s.x,s.y,o.x,o.y)) return;
    if(o.side===s.side) friendsIn++; else enemiesIn++;
  });
  const torpBlock = `
    <div><b style="color:var(--accent);">Torpedoes</b>
      <span class="smallDim">— pick each one to launch; they fire when you end the phase.</span></div>
    ${slots.length ? `<div class="grid2" style="margin-top:4px;">${slots.map((sl,i)=>{
        const on = sel.has(sl.key);
        return `<button class="torpSlotBtn ${on?'queued':''}" data-slot="${sl.key}" title="Tube ${sl.tube+1}" ${locked?'disabled':''}>${on?'✓ ':''}Torpedo ${i+1}</button>`;
      }).join('')}</div>` : `<div class="smallDim" style="margin-top:4px;">None ready — the tubes are empty or reloading.</div>`}
    <div class="shotRow">${torpedoShotCirclesHTML(s.torpedoTubes)}</div>
    <div class="smallDim">In your lane now: <b style="color:var(--bad);">${enemiesIn} enemy</b>, <b style="color:${friendsIn?'var(--gold)':'var(--dim)'};">${friendsIn} friendly</b>. Strikes at the end
    of the <i>next</i> Movement phase: closest ship in the lane, friend or foe.</div>
    <div style="margin-top:8px;">${locked
      ? `<button id="editLaunchBtn" style="width:100%;">Edit Launch</button><div class="smallDim" style="text-align:center;">${nSel} torpedo${nSel===1?'':'es'} confirmed — launching when the phase ends.</div>`
      : `<button id="confirmLaunchBtn" class="primary" style="width:100%;" ${nSel?'':'disabled'}>Confirm Launch${nSel?` (${nSel})`:''}</button>`}</div>`;
  return `<div class="card">
    <h3 style="margin:2px 0;color:var(--gold);">Torpedo Attack</h3>
    ${torpBlock}
    ${!locked ? `<div style="margin-top:8px;"><button id="backFromTorpedoBtn" style="width:100%;">← Back</button></div>` : ''}
  </div>`;
}
// All Ahead Full: in the Firing phase this ship plots an extra move INSTEAD of shooting. The move is made only after
// every shot of the phase has been rolled.
function extraMoveOrdersHTML(s){
  const head = `<div class="card">
    <h3 style="margin:2px 0;color:var(--gold);">All Ahead Full</h3>
    <div class="smallDim">No shooting this phase. Plot an extra move: drag this ship on the map. It is made after every shot of the phase (including any at this ship) has been rolled.</div>
  </div>`;
  if(s.grounded) return head + `<div class="card"><div class="smallDim">Aground — it cannot move.</div></div>`;
  if(s.extraPlan){
    return head + `<div class="card">
      <h3 style="margin:2px 0;color:var(--good);">Extra Move Plotted</h3>
      <div class="smallDim">${s.extraPlan.speed.toFixed(0)}" ${s.extraPlan.turns.length?`turning ${Math.abs(s.extraPlan.turns[0].deg)}° to ${s.extraPlan.turns[0].deg>0?'starboard':'port'}`:'holding heading'}.</div>
      ${state.firingCommenced ? '' : `<div class="row" style="margin-top:6px;"><button id="editExtraBtn" style="width:100%;">Edit Move</button></div>`}
    </div>`;
  }
  const minSpd = Math.round(minSpeedFor(s)), maxSpd = Math.round(s.movement);
  if(!state.moveDraft) state.moveDraft = defaultMoveDraft(s);
  const d = state.moveDraft;
  if(d.speed < minSpd) d.speed = minSpd;
  if(d.speed > maxSpd) d.speed = maxSpd;
  const preview = computePath(s, d);
  const turnDesc = d.turns.length ? `turning ${Math.abs(d.turns[0].deg)}° to ${d.turns[0].deg>0?'starboard':'port'}` : 'holding heading';
  return head + `<div class="card">
    <h3 style="margin:2px 0;color:var(--gold);">Extra Move</h3>
    <div class="smallDim">Momentum: min ${minSpd}" &middot; max ${maxSpd}" (it keeps building from its move this round).</div>
    <div class="card" style="background:#031018;margin:6px 0;">
      <b style="color:var(--accent);">${d.speed}"</b> <span class="smallDim">${turnDesc}</span>
      ${preview.islandHit ? '<div style="color:var(--bad);font-weight:600;margin-top:3px;">⚠ Runs aground at this course!</div>' : ''}
    </div>
  </div>
  <div id="confirmBtnRow" class="row"><button class="primary" id="confirmExtraBtn">Confirm Extra Move</button></div>`;
}
function confirmExtraMove(){
  const s = shipById(state.selectedShipId);
  if(!s || !extraMoveMode(s) || s.extraPlan) return;
  const d = state.moveDraft || defaultMoveDraft(s);
  s.extraPlan = { speed: Math.max(minSpeedFor(s), Math.min(s.movement, d.speed)), turns:(d.turns||[]).map(t=>({deg:t.deg})), minePlacedAtCum:null };
  s.moveDragPreview = null;
  logMsg('sys', `${shipLabel(s)} plots its All Ahead Full move (${s.extraPlan.speed.toFixed(0)}"); it will be made after the shooting.`);
  state.selectedShipIds.delete(s.id);
  setActiveFromSelection();
  state.moveDraft = null;
  updatePhaseBanner(); render(); renderPanel();
}
function firingOrdersHTML(s){
  const enemies = state.fleets.ai.filter(e=>!e.destroyed);
  if(!s.queuedFire) s.queuedFire = { broadsidePort: [], broadsideStarboard: [], turret: [], torpedo: [] };
  const q = s.queuedFire;
  const locked = s.firingConfirmed;
  // the target the dropdown currently shows: the player's last pick, else the confirmed turret target, else the first enemy
  const fireSel = enemies.find(e=>e.id===s.fireTargetPick) || (s.targetConfirmed ? enemies.find(e=>e.id===s.aimTargetId) : null) || enemies[0] || null;
  const halfRate = fireSel && s.turretWeapons.some(Boolean) && turretFireCost(s, fireSel)>1;
  const groupRow = (label, groupKey, queueArr, shotsHTML)=>{
    const max = maxVolleysForGroup(s, groupKey);
    const queuedNames = queueArr.map(id=>{ const t=shipById(id); return t?shipLabel(t):'?'; });
    const btnId = 'fireBtn_'+groupKey;
    const disabled = locked || max===0 || volleysUsed(s, groupKey, queueArr)>=max;
    const isQueued = queueArr.length>0;
    return `<div>
      <button id="${btnId}" class="${isQueued?'queued':''}" style="width:100%;" ${disabled?'disabled':''}>${label}${max>1?` (${queueArr.length}/${max})`:''}</button>
      <div class="queuedList">${queuedNames.length ? 'Queued → '+queuedNames.join(', ') : ''}</div>
      <div class="shotRow">${shotsHTML}</div>
    </div>`;
  };
  return `<div class="card">
    <h3 style="margin:2px 0;color:var(--gold);">Fire Control</h3>
    <div class="row"><label>Target:</label>
      <select id="fireTargetSel" ${locked?'disabled':''}>
      ${enemies.map(e=>`<option value="${e.id}" ${fireSel && fireSel.id===e.id?'selected':''}>${shipLabelTyped(e)} (${Math.round(dist(s.x,s.y,e.x,e.y))}")${lineBlockedByIsland(s.x,s.y,e.x,e.y)?' — island blocks LOS':''}</option>`).join('')}
      </select>
    </div>
    ${deadWater(s) && s.turretWeapons.some(Boolean) ? '<div class="smallDim" style="color:#ff9a6c;margin-bottom:4px;">&#9888; Dead in the water: turrets cannot fire. Broadsides still can.</div>' : ''}
    <div class="grid2">
      ${groupRow('Fire Port Broadside','broadsidePort',q.broadsidePort,shotCirclesHTML(s.broadsidePort))}
      ${groupRow('Fire Starboard Broadside','broadsideStarboard',q.broadsideStarboard,shotCirclesHTML(s.broadsideStarboard))}
      ${groupRow('Fire Turrets','turret',q.turret,shotCirclesHTML(s.turretWeapons))}
    </div>
    ${halfRate ? `<div class="smallDim" style="color:#ff9a6c;margin-top:4px;">&#9888; ${shipLabel(fireSel)} is in this ship's ${arcOfBearing(s.heading, bearingFromTo(s.x,s.y,fireSel.x,fireSel.y))==='prow'?'front':'rear'} arc: turrets can only make half their shots at it.</div>` : ''}
    <div class="row" style="margin-top:8px;">
      ${locked
        ? `<button id="editTargetingBtn" style="width:100%;">Edit Targeting</button>`
        : `<button id="confirmTargetingBtn" class="primary" style="width:100%;">Confirm Targeting</button>`}
    </div>
    ${locked ? `<div class="smallDim" style="text-align:center;">Targeting confirmed.</div>` : ''}
  </div>`;
}

function wireUpPanel(s){
  if(state.phase==='movement'){
    if(s.grounded && s.grounded.phase==='frozen'){
      // no controls — nothing to wire, ship is auto-skipped this turn
    } else if(s.grounded && s.grounded.phase==='ready'){
      document.getElementById('refloatHeadingSlider').oninput = (e)=>{
        s.refloatHeading = parseInt(e.target.value);
        document.getElementById('refloatHeadingVal').textContent = s.refloatHeading;
        render();
      };
      document.getElementById('confirmRefloatBtn').onclick = confirmRefloat;
    } else {
      // A ship that has already moved this phase gets a locked "Movement Confirmed" card — no button to wire.
      const cm = document.getElementById('confirmMoveBtn');
      if(cm) cm.onclick = confirmMovement;
    }
    // Turret Target controls (present on every Movement panel variant)
    const tsel = document.getElementById('targetSel');
    if(tsel) tsel.onchange = (e)=>{ s.aimTargetId = e.target.value || null; render(); renderPanel(); };
    const ctb = document.getElementById('confirmTargetBtn');
    if(ctb) ctb.onclick = ()=>{
      const t = shipById(s.aimTargetId);
      if(!t || t.destroyed) return;
      s.targetConfirmed = true;
      logMsg('sys', `${shipLabel(s)} targets ${shipLabel(t)}.`);
      render(); renderPanel();
    };
    const etb = document.getElementById('editTargetBtn');
    if(etb) etb.onclick = ()=>{ s.targetConfirmed = false; render(); renderPanel(); };
  } else if(state.phase==='special'){
    // Choosing an action: exactly one of these three per ship per phase.
    const ctb = document.getElementById('chooseTorpedoBtn');
    if(ctb) ctb.onclick = ()=>{ s.specialOrderMode='torpedo'; render(); renderPanel(); };
    const cmb = document.getElementById('chooseMineBtn');
    if(cmb) cmb.onclick = ()=>{ s.specialOrderMode='mine'; render(); renderPanel(); };
    const ccb = document.getElementById('chooseCourseBtn');
    if(ccb) ccb.onclick = ()=>{ s.specialOrderMode='course'; s.courseAdjustHeading = s.heading; render(); renderPanel(); };
    const cfb = document.getElementById('chooseFullBtn');
    if(cfb) cfb.onclick = ()=>{ s.specialOrderMode='full'; s.flagOrderConfirmed=false; render(); renderPanel(); };
    const crb = document.getElementById('chooseReverseBtn');
    if(crb) crb.onclick = ()=>{ s.specialOrderMode='reverse'; s.flagOrderConfirmed=false; render(); renderPanel(); };
    const bff = document.getElementById('backFromFlagBtn');
    if(bff) bff.onclick = ()=>{ s.specialOrderMode=null; s.flagOrderConfirmed=false; render(); renderPanel(); };
    const cfo = document.getElementById('confirmFlagOrderBtn');
    if(cfo) cfo.onclick = ()=>{ s.flagOrderConfirmed=true; render(); renderPanel(); };
    const cano = document.getElementById('cancelFlagOrderBtn');
    if(cano) cano.onclick = ()=>{ s.flagOrderConfirmed=false; render(); renderPanel(); };
    // "Back" from any of the three returns to the picker, discarding that ship's in-progress choice.
    const bft = document.getElementById('backFromTorpedoBtn');
    if(bft) bft.onclick = ()=>{ s.specialOrderMode=null; s.torpSelected=[]; render(); renderPanel(); };
    const bfm = document.getElementById('backFromMineBtn');
    if(bfm) bfm.onclick = ()=>{ s.specialOrderMode=null; render(); renderPanel(); };
    const bfc = document.getElementById('backFromCourseBtn');
    if(bfc) bfc.onclick = ()=>{ s.specialOrderMode=null; s.courseAdjustHeading=null; render(); renderPanel(); };
    // Torpedo Attack.
    document.querySelectorAll('.torpSlotBtn').forEach(b=>{
      b.onclick = ()=>{
        const arr = s.torpSelected || (s.torpSelected = []);
        const i = arr.indexOf(b.dataset.slot);
        if(i>=0) arr.splice(i,1); else arr.push(b.dataset.slot);
        render(); renderPanel();
      };
    });
    const cl = document.getElementById('confirmLaunchBtn');
    if(cl) cl.onclick = ()=>{ s.torpConfirmed = true; render(); renderPanel(); };
    const el = document.getElementById('editLaunchBtn');
    if(el) el.onclick = ()=>{ s.torpConfirmed = false; render(); renderPanel(); };
    // Lay Mine — this only STAGES the choice now; the mine is actually placed (and its Firing
    // Window played) when the phase ends, same as a confirmed torpedo launch.
    const cmib = document.getElementById('confirmMineBtn');
    if(cmib) cmib.onclick = ()=>{ s.mineOrderConfirmed = true; render(); renderPanel(); };
    const canm = document.getElementById('cancelMineBtn');
    if(canm) canm.onclick = ()=>{ s.mineOrderConfirmed = false; render(); renderPanel(); };
    // Course Adjustment.
    const ccfb = document.getElementById('confirmCourseBtn');
    if(ccfb) ccfb.onclick = ()=>{
      s.heading = normDeg(s.courseAdjustHeading!=null ? s.courseAdjustHeading : s.courseHeadingStart);
      s.courseAdjustHeading = s.heading;
      settleTurretWithHull(s); // an untargeted turret turns with the ship
      s.courseConfirmed = true;
      render(); renderPanel();
    };
    const edc = document.getElementById('editCourseBtn');
    if(edc) edc.onclick = ()=>{ s.courseConfirmed = false; render(); renderPanel(); };
  } else if(state.phase==='firing'){
    if(s.activeOrder==='full'){
      const ce = document.getElementById('confirmExtraBtn');
      if(ce) ce.onclick = confirmExtraMove;
      const ee = document.getElementById('editExtraBtn');
      if(ee) ee.onclick = ()=>{ s.extraPlan = null; state.moveDraft = defaultMoveDraft(s); updatePhaseBanner(); render(); renderPanel(); };
      return;
    }
    if(s.firingConfirmed){
      const editBtn = document.getElementById('editTargetingBtn');
      if(editBtn) editBtn.onclick = ()=>{ s.firingConfirmed=false; updatePhaseBanner(); renderPanel(); };
      return; // everything else in this panel is disabled while confirmed
    }
    const getTarget = ()=> shipById(document.getElementById('fireTargetSel').value);
    document.getElementById('fireTargetSel').onchange = (e)=>{ s.fireTargetPick = e.target.value; renderPanel(); };
    const queueGroup = (groupKey, arr)=>{
      const t = getTarget();
      if(!t){ alert('Pick a target first.'); return; }
      if(volleysUsed(s, groupKey, arr) < maxVolleysForGroup(s, groupKey)){
        arr.push(t.id);
        renderPanel();
      }
    };
    document.getElementById('fireBtn_broadsidePort').onclick=()=> queueGroup('broadsidePort', s.queuedFire.broadsidePort);
    document.getElementById('fireBtn_broadsideStarboard').onclick=()=> queueGroup('broadsideStarboard', s.queuedFire.broadsideStarboard);
    document.getElementById('fireBtn_turret').onclick=()=> queueGroup('turret', s.queuedFire.turret);
    document.getElementById('confirmTargetingBtn').onclick = ()=>{
      s.firingConfirmed = true;
      updatePhaseBanner();
      renderPanel();
    };
  }
}

/* boot: nothing else to do until user picks fleet */
