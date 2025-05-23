export const maxLabelCount = 500;

export const maxInstructionCount = 1000;

export const counterVar = "@counter";
export const waitVar = "@wait";

export const keywords = ["true", "false", "null"];

export const mathConstants = ["@pi", "@e", "@degToRad", "@radToDeg"];

export const globalReadonlyVariables = [
  "@unit",
  "@this",
  "@thisx",
  "@thisy",
  "@links",
  "@ipt",
  "@time",
  "@tick",
  "@second",
  "@minute",
  "@waveNumber",
  "@waveTime",
  "@mapw",
  "@maph",
  waitVar,
  "@server",
  "@client",
  "@clientLocale",
  "@clientUnit",
  "@clientName",
  "@clientTeam",
  "@clientMobile",
  "@ctrlPlayer",
  "@ctrlProcessor",
  "@ctrlCommand",
  "@itemCount",
  "@liquidCount",
  "@unitCount",
  "@blockCount",
];

const buildingBlockNames = [
  "graphite-press",
  "multi-press",
  "silicon-smelter",
  "silicon-crucible",
  "kiln",
  "plastanium-compressor",
  "phase-weaver",
  "surge-smelter",
  "cryofluid-mixer",
  "pyratite-mixer",
  "blast-mixer",
  "melter",
  "separator",
  "disassembler",
  "spore-press",
  "pulverizer",
  "coal-centrifuge",
  "incinerator",
  "silicon-arc-furnace",
  "electrolyzer",
  "atmospheric-concentrator",
  "oxidation-chamber",
  "electric-heater",
  "slag-heater",
  "phase-heater",
  "heat-redirector",
  "heat-router",
  "slag-incinerator",
  "carbide-crucible",
  "slag-centrifuge",
  "surge-crucible",
  "cyanogen-synthesizer",
  "phase-synthesizer",
  "heat-reactor",
  "copper-wall",
  "copper-wall-large",
  "titanium-wall",
  "titanium-wall-large",
  "plastanium-wall",
  "plastanium-wall-large",
  "thorium-wall",
  "thorium-wall-large",
  "phase-wall",
  "phase-wall-large",
  "surge-wall",
  "surge-wall-large",
  "door",
  "door-large",
  "scrap-wall",
  "scrap-wall-large",
  "scrap-wall-huge",
  "scrap-wall-gigantic",
  "thruster",
  "beryllium-wall",
  "beryllium-wall-large",
  "tungsten-wall",
  "tungsten-wall-large",
  "blast-door",
  "reinforced-surge-wall",
  "reinforced-surge-wall-large",
  "carbide-wall",
  "carbide-wall-large",
  "shielded-wall",
  "mender",
  "mend-projector",
  "overdrive-projector",
  "overdrive-dome",
  "force-projector",
  "shock-mine",
  "radar",
  "build-tower",
  "regen-projector",
  "shockwave-tower",
  "shield-projector",
  "large-shield-projector",
  "conveyor",
  "titanium-conveyor",
  "plastanium-conveyor",
  "armored-conveyor",
  "junction",
  "bridge-conveyor",
  "phase-conveyor",
  "sorter",
  "inverted-sorter",
  "router",
  "distributor",
  "overflow-gate",
  "underflow-gate",
  "mass-driver",
  "duct",
  "armored-duct",
  "duct-router",
  "overflow-duct",
  "underflow-duct",
  "duct-bridge",
  "duct-unloader",
  "surge-conveyor",
  "surge-router",
  "unit-cargo-loader",
  "unit-cargo-unload-point",
  "mechanical-pump",
  "rotary-pump",
  "impulse-pump",
  "conduit",
  "pulse-conduit",
  "plated-conduit",
  "liquid-router",
  "liquid-container",
  "liquid-tank",
  "liquid-junction",
  "bridge-conduit",
  "phase-conduit",
  "reinforced-pump",
  "reinforced-conduit",
  "reinforced-liquid-junction",
  "reinforced-bridge-conduit",
  "reinforced-liquid-router",
  "reinforced-liquid-container",
  "reinforced-liquid-tank",
  "power-node",
  "power-node-large",
  "surge-tower",
  "diode",
  "battery",
  "battery-large",
  "combustion-generator",
  "thermal-generator",
  "steam-generator",
  "differential-generator",
  "rtg-generator",
  "solar-panel",
  "solar-panel-large",
  "thorium-reactor",
  "impact-reactor",
  "beam-node",
  "beam-tower",
  "beam-link",
  "turbine-condenser",
  "chemical-combustion-chamber",
  "pyrolysis-generator",
  "flux-reactor",
  "neoplasia-reactor",
  "mechanical-drill",
  "pneumatic-drill",
  "laser-drill",
  "blast-drill",
  "water-extractor",
  "cultivator",
  "oil-extractor",
  "vent-condenser",
  "cliff-crusher",
  "plasma-bore",
  "large-plasma-bore",
  "impact-drill",
  "eruption-drill",
  "core-shard",
  "core-foundation",
  "core-nucleus",
  "core-bastion",
  "core-citadel",
  "core-acropolis",
  "container",
  "vault",
  "unloader",
  "reinforced-container",
  "reinforced-vault",
  "duo",
  "scatter",
  "scorch",
  "hail",
  "wave",
  "lancer",
  "arc",
  "parallax",
  "swarmer",
  "salvo",
  "segment",
  "tsunami",
  "fuse",
  "ripple",
  "cyclone",
  "foreshadow",
  "spectre",
  "meltdown",
  "breach",
  "diffuse",
  "sublimate",
  "titan",
  "disperse",
  "afflict",
  "lustre",
  "scathe",
  "smite",
  "malign",
  "ground-factory",
  "air-factory",
  "naval-factory",
  "additive-reconstructor",
  "multiplicative-reconstructor",
  "exponential-reconstructor",
  "tetrative-reconstructor",
  "repair-point",
  "repair-turret",
  "tank-fabricator",
  "ship-fabricator",
  "mech-fabricator",
  "tank-refabricator",
  "ship-refabricator",
  "mech-refabricator",
  "prime-refabricator",
  "tank-assembler",
  "ship-assembler",
  "mech-assembler",
  "basic-assembler-module",
  "unit-repair-tower",
  "payload-conveyor",
  "payload-router",
  "reinforced-payload-conveyor",
  "reinforced-payload-router",
  "payload-mass-driver",
  "large-payload-mass-driver",
  "small-deconstructor",
  "deconstructor",
  "constructor",
  "large-constructor",
  "payload-loader",
  "payload-unloader",
  "power-source",
  "power-void",
  "item-source",
  "item-void",
  "liquid-source",
  "liquid-void",
  "payload-source",
  "payload-void",
  "heat-source",
  "illuminator",
  "legacy-mech-pad",
  "legacy-unit-factory",
  "legacy-unit-factory-air",
  "legacy-unit-factory-ground",
  "command-center",
  "launch-pad",
  "interplanetary-accelerator",
  "message",
  "switch",
  "micro-processor",
  "logic-processor",
  "hyper-processor",
  "memory-cell",
  "memory-bank",
  "logic-display",
  "large-logic-display",
  "canvas",
  "reinforced-message",
  "world-processor",
  "world-cell",
  "world-message",
  "world-switch",
];

const otherBlockNames = [
  "build1",
  "build2",
  "build3",
  "build4",
  "build5",
  "build6",
  "build7",
  "build8",
  "build9",
  "build10",
  "build11",
  "build12",
  "build13",
  "build14",
  "build15",
  "build16",
  "air",
  "spawn",
  "cliff",
  "deep-water",
  "shallow-water",
  "tainted-water",
  "deep-tainted-water",
  "darksand-tainted-water",
  "sand-water",
  "darksand-water",
  "tar",
  "pooled-cryofluid",
  "molten-slag",
  "space",
  "empty",
  "stone",
  "crater-stone",
  "char",
  "basalt",
  "hotrock",
  "magmarock",
  "sand-floor",
  "darksand",
  "dirt",
  "mud",
  "dacite",
  "rhyolite",
  "rhyolite-crater",
  "rough-rhyolite",
  "regolith",
  "yellow-stone",
  "carbon-stone",
  "ferric-stone",
  "ferric-craters",
  "beryllic-stone",
  "crystalline-stone",
  "crystal-floor",
  "yellow-stone-plates",
  "red-stone",
  "dense-red-stone",
  "red-ice",
  "arkycite-floor",
  "arkyic-stone",
  "rhyolite-vent",
  "carbon-vent",
  "arkyic-vent",
  "yellow-stone-vent",
  "red-stone-vent",
  "crystalline-vent",
  "redmat",
  "bluemat",
  "grass",
  "salt",
  "snow",
  "ice",
  "ice-snow",
  "shale",
  "moss",
  "core-zone",
  "spore-moss",
  "stone-wall",
  "spore-wall",
  "dirt-wall",
  "dacite-wall",
  "ice-wall",
  "snow-wall",
  "dune-wall",
  "regolith-wall",
  "yellow-stone-wall",
  "rhyolite-wall",
  "carbon-wall",
  "ferric-stone-wall",
  "beryllic-stone-wall",
  "arkyic-wall",
  "crystalline-stone-wall",
  "red-ice-wall",
  "red-stone-wall",
  "red-diamond-wall",
  "sand-wall",
  "salt-wall",
  "shrubs",
  "shale-wall",
  "spore-pine",
  "snow-pine",
  "pine",
  "white-tree-dead",
  "white-tree",
  "spore-cluster",
  "redweed",
  "pur-bush",
  "yellowcoral",
  "boulder",
  "snow-boulder",
  "shale-boulder",
  "sand-boulder",
  "dacite-boulder",
  "basalt-boulder",
  "carbon-boulder",
  "ferric-boulder",
  "beryllic-boulder",
  "yellow-stone-boulder",
  "arkyic-boulder",
  "crystal-cluster",
  "vibrant-crystal-cluster",
  "crystal-blocks",
  "crystal-orbs",
  "crystalline-boulder",
  "red-ice-boulder",
  "rhyolite-boulder",
  "red-stone-boulder",
  "metal-floor",
  "metal-floor-damaged",
  "metal-floor-2",
  "metal-floor-3",
  "metal-floor-4",
  "metal-floor-5",
  "dark-panel-1",
  "dark-panel-2",
  "dark-panel-3",
  "dark-panel-4",
  "dark-panel-5",
  "dark-panel-6",
  "dark-metal",
  "pebbles",
  "tendrils",
  "ore-copper",
  "ore-lead",
  "ore-scrap",
  "ore-coal",
  "ore-titanium",
  "ore-thorium",
  "ore-beryllium",
  "ore-tungsten",
  "ore-crystal-thorium",
  "ore-wall-thorium",
  "ore-wall-beryllium",
  "graphitic-wall",
  "ore-wall-tungsten",
];

export const teams = [
  "@derelict",
  "@sharded",
  "@crux",
  "@malis",
  "@green",
  "@blue",
];

export const colorData: Record<string, string> = {
  tan: "d2b48cff",
  sky: "87ceebff",
  pink: "ff69b4ff",
  lightgrey: "bfbfbfff",
  white: "ffffffff",
  lightgray: "bfbfbfff",
  magenta: "ff00ffff",
  salmon: "fa8072ff",
  coral: "ff7f50ff",
  grey: "7f7f7fff",
  darkgrey: "3f3f3fff",
  lime: "32cd32ff",
  brown: "8b4513ff",
  blue: "4169e1ff",
  green: "38d667ff",
  teal: "007f7fff",
  forest: "228b22ff",
  black: "000000ff",
  gold: "ffd700ff",
  brick: "b22222ff",
  gray: "7f7f7fff",
  cyan: "00ffffff",
  royal: "4169e1ff",
  violet: "ee82eeff",
  yellow: "ffff00ff",
  clear: "000000",
  orange: "ffa500ff",
  maroon: "b03060ff",
  red: "e55454ff",
  darkgray: "3f3f3fff",
  navy: "00007fff",
  scarlet: "ff341cff",
  slate: "708090ff",
  olive: "6b8e23ff",
  purple: "a020f0ff",
  acid: "7fff00ff",
  goldenrod: "daa520ff",
  crimson: "dc143cff",
  accent: "ffd37fff",
  unlaunched: "8982edff",
  highlight: "ffe0a5ff",
  stat: "ffd37fff",
  negstat: "e55454ff",
};

export const colors = Object.keys(colorData).map(makeColorVarName);

export const items = [
  "@copper",
  "@lead",
  "@metaglass",
  "@graphite",
  "@sand",
  "@coal",
  "@titanium",
  "@thorium",
  "@scrap",
  "@silicon",
  "@plastanium",
  "@phase-fabric",
  "@surge-alloy",
  "@spore-pod",
  "@blast-compound",
  "@pyratite",
  "@beryllium",
  "@tungsten",
  "@oxide",
  "@carbide",
  "@fissile-matter",
  "@dormant-cyst",
];

export const liquids = [
  "@water",
  "@slag",
  "@oil",
  "@cryofluid",
  "@neoplasm",
  "@arkycite",
  "@gallium",
  "@ozone",
  "@hydrogen",
  "@nitrogen",
  "@cyanogen",
];

export const blocks = getBlocks();

export const sensors = [
  "@totalItems",
  "@firstItem",
  "@totalLiquids",
  "@totalPower",
  "@itemCapacity",
  "@liquidCapacity",
  "@powerCapacity",
  "@powerNetStored",
  "@powerNetCapacity",
  "@powerNetIn",
  "@powerNetOut",
  "@ammo",
  "@ammoCapacity",
  "@currentAmmoType",
  "@memoryCapacity",
  "@health",
  "@maxHealth",
  "@heat",
  "@shield",
  "@armor",
  "@efficiency",
  "@progress",
  "@timescale",
  "@rotation",
  "@x",
  "@y",
  "@velocityX",
  "@velocityY",
  "@shootX",
  "@shootY",
  "@cameraX",
  "@cameraY",
  "@cameraWidth",
  "@cameraHeight",
  "@displayWidth",
  "@displayHeight",
  "@bufferUsage",
  "@size",
  "@solid",
  "@dead",
  "@range",
  "@shooting",
  "@boosting",
  "@mineX",
  "@mineY",
  "@mining",
  "@speed",
  "@team",
  "@type",
  "@flag",
  "@controlled",
  "@controller",
  "@name",
  "@payloadCount",
  "@payloadType",
  "@totalPayload",
  "@payloadCapacity",
  "@id",
  "@enabled",
  "@shoot",
  "@shootp",
  "@config",
  "@color",
];

export const units = [
  "@dagger",
  "@mace",
  "@fortress",
  "@scepter",
  "@reign",
  "@nova",
  "@pulsar",
  "@quasar",
  "@vela",
  "@corvus",
  "@crawler",
  "@atrax",
  "@spiroct",
  "@arkyid",
  "@toxopid",
  "@flare",
  "@horizon",
  "@zenith",
  "@antumbra",
  "@eclipse",
  "@mono",
  "@poly",
  "@mega",
  "@quad",
  "@oct",
  "@risso",
  "@minke",
  "@bryde",
  "@sei",
  "@omura",
  "@retusa",
  "@oxynoe",
  "@cyerce",
  "@aegires",
  "@navanax",
  "@alpha",
  "@beta",
  "@gamma",
  "@stell",
  "@locus",
  "@precept",
  "@vanquish",
  "@conquer",
  "@merui",
  "@cleroi",
  "@anthicus",
  "@anthicus-missile",
  "@tecta",
  "@collaris",
  "@elude",
  "@avert",
  "@obviate",
  "@quell",
  "@quell-missile",
  "@disrupt",
  "@disrupt-missile",
  "@renale",
  "@latum",
  "@evoke",
  "@incite",
  "@emanate",
  "@block",
  "@manifold",
  "@assembly-drone",
  "@scathe-missile",
  "@turret-unit-build-tower",
];

export const soundNames = [
  "@sfx-artillery",
  "@sfx-bang",
  "@sfx-beam",
  "@sfx-bigshot",
  "@sfx-bioLoop",
  "@sfx-blaster",
  "@sfx-bolt",
  "@sfx-boom",
  "@sfx-break",
  "@sfx-build",
  "@sfx-buttonClick",
  "@sfx-cannon",
  "@sfx-click",
  "@sfx-combustion",
  "@sfx-conveyor",
  "@sfx-corexplode",
  "@sfx-cutter",
  "@sfx-door",
  "@sfx-drill",
  "@sfx-drillCharge",
  "@sfx-drillImpact",
  "@sfx-dullExplosion",
  "@sfx-electricHum",
  "@sfx-explosion",
  "@sfx-explosionbig",
  "@sfx-extractLoop",
  "@sfx-fire",
  "@sfx-flame",
  "@sfx-flame2",
  "@sfx-flux",
  "@sfx-glow",
  "@sfx-grinding",
  "@sfx-hum",
  "@sfx-largeCannon",
  "@sfx-largeExplosion",
  "@sfx-laser",
  "@sfx-laserbeam",
  "@sfx-laserbig",
  "@sfx-laserblast",
  "@sfx-lasercharge",
  "@sfx-lasercharge2",
  "@sfx-lasershoot",
  "@sfx-machine",
  "@sfx-malignShoot",
  "@sfx-mediumCannon",
  "@sfx-minebeam",
  "@sfx-mineDeploy",
  "@sfx-missile",
  "@sfx-missileLarge",
  "@sfx-missileLaunch",
  "@sfx-missileSmall",
  "@sfx-missileTrail",
  "@sfx-mud",
  "@sfx-noammo",
  "@sfx-pew",
  "@sfx-place",
  "@sfx-plantBreak",
  "@sfx-plasmaboom",
  "@sfx-plasmadrop",
  "@sfx-pulse",
  "@sfx-pulseBlast",
  "@sfx-railgun",
  "@sfx-rain",
  "@sfx-release",
  "@sfx-respawn",
  "@sfx-respawning",
  "@sfx-rockBreak",
  "@sfx-sap",
  "@sfx-shield",
  "@sfx-shockBlast",
  "@sfx-shoot",
  "@sfx-shootAlt",
  "@sfx-shootAltLong",
  "@sfx-shootBig",
  "@sfx-shootSmite",
  "@sfx-shootSnap",
  "@sfx-shotgun",
  "@sfx-smelter",
  "@sfx-spark",
  "@sfx-spellLoop",
  "@sfx-splash",
  "@sfx-spray",
  "@sfx-steam",
  "@sfx-techloop",
  "@sfx-thruster",
  "@sfx-titanExplosion",
  "@sfx-torch",
  "@sfx-tractorbeam",
  "@sfx-wave",
  "@sfx-wind",
  "@sfx-wind2",
  "@sfx-wind3",
  "@sfx-windhowl",
  "@sfx-back",
  "@sfx-chatMessage",
  "@sfx-message",
  "@sfx-press",
  "@sfx-unlock",
];

export const builtinGlobals = [
  ...mathConstants,
  ...globalReadonlyVariables,
  counterVar,
  ...teams,
  ...colors,
  ...items,
  ...liquids,
  ...blocks,
  ...sensors,
  ...units,
  ...soundNames,
];

export const builtinGlobalsSet = new Set(builtinGlobals);

export const buildingLinkNames = getBuildingLinkNames();

function getBuildingLinkNames() {
  const names = new Set<string>();

  for (const name of buildingBlockNames) {
    if (!name.includes("-")) {
      names.add(name);
      continue;
    }

    const parts = name.split("-");

    // filter out 'large' at the end of block names
    // and filter numbers at the end of block names
    if (
      parts.length >= 2 &&
      (parts[parts.length - 1] === "large" ||
        !Number.isNaN(Number(parts[parts.length - 1])))
    ) {
      names.add(parts[parts.length - 2]);
    } else {
      names.add(parts[parts.length - 1]);
    }
  }

  return names;
}

function getBlocks() {
  const blocks: string[] = [];

  for (const block of buildingBlockNames) {
    blocks.push(`@${block}`);
  }

  for (const block of otherBlockNames) {
    blocks.push(`@${block}`);
  }

  return blocks;
}

export function isColorName(name: string) {
  return Object.prototype.hasOwnProperty.call(colorData, name);
}

export function makeColorVarName(color: string) {
  return "@color" + color[0].toUpperCase() + color.slice(1);
}
