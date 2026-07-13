// T-47: curated word lists for human-friendly room codes (e.g. door-cat-hall).
// Drafted by Frontend-Claude as data for TechLead-Claude's codeGen to consume.
//
// Curation rules applied to every entry:
//   - concrete, common, everyday words a person can hear-and-spell correctly
//   - no profanity, slurs, or embarrassing terms (individually)
//   - no homophone/ambiguous-spelling traps (no "their/there", "flour/flower")
//   - lowercase, exact length (FOUR = 4 letters, THREE = 3 letters)
//   - no proper nouns, no abbreviations, no plurals-that-look-odd
//
// The generator still owns: combo-level profanity/embarrassment filtering
// (adjacent words can be unfortunate even when each is clean), uniqueness /
// collision-retry, canonicalization, and backward-compat with legacy
// alphanumeric codes. These arrays are purely the vocabulary.
//
// Code shape (host spec): FOUR-THREE-FOUR, e.g. "door-cat-hall".
// Entropy with the lists below ≈ FOUR × THREE × FOUR combinations; expand the
// arrays anytime to grow the space — the generator does not assume a size.

/** 4-letter words — used for positions 1 and 3. */
export const CODE_WORDS_FOUR: readonly string[] = [
  'able', 'acid', 'acre', 'atom', 'aunt', 'aura', 'bake', 'bald', 'ball', 'band',
  'bank', 'barn', 'base', 'bath', 'beam', 'bean', 'bear', 'beat', 'bell', 'belt',
  'bend', 'best', 'bike', 'bird', 'blue', 'boat', 'bold', 'bolt', 'bone', 'book',
  'boot', 'boss', 'bowl', 'brew', 'buck', 'bulb', 'bunk', 'burn', 'bush', 'busy',
  'cafe', 'cake', 'calm', 'camp', 'cane', 'cape', 'card', 'care', 'cart', 'cash',
  'cave', 'cell', 'chef', 'chin', 'chip', 'city', 'clam', 'clap', 'claw', 'clay',
  'clip', 'clog', 'club', 'clue', 'coal', 'coat', 'code', 'coin', 'cold', 'cook',
  'cool', 'cope', 'copy', 'cord', 'cork', 'corn', 'cove', 'crab', 'crew', 'crop',
  'cube', 'curl', 'dark', 'dart', 'dash', 'dawn', 'deck', 'deer', 'desk', 'dial',
  'dice', 'dike', 'dime', 'dine', 'dish', 'dock', 'door', 'dove', 'draw', 'drip',
  'drum', 'dune', 'dusk', 'dust', 'duty', 'east', 'easy', 'echo', 'edge', 'exit',
  'face', 'fact', 'fair', 'fall', 'farm', 'fast', 'fawn', 'fern', 'file', 'film',
  'fine', 'fire', 'firm', 'fish', 'fist', 'five', 'flag', 'flat', 'flax', 'flip',
  'foam', 'fold', 'font', 'food', 'foot', 'fork', 'fort', 'four', 'frog', 'fuel',
  'fund', 'gain', 'gala', 'game', 'gate', 'gaze', 'gear', 'gift', 'girl', 'glad',
  'glow', 'glue', 'goal', 'goat', 'gold', 'golf', 'gong', 'good', 'gown', 'grab',
  'gray', 'grid', 'grin', 'grip', 'gulf', 'hail', 'hall', 'hand', 'hare', 'harp',
  'hawk', 'haze', 'head', 'heap', 'herb', 'hero', 'hill', 'hint', 'hive', 'hold',
  'hood', 'hoof', 'hook', 'hoop', 'horn', 'hose', 'host', 'hour', 'hunt', 'hush',
  'iron', 'isle', 'item', 'jade', 'jazz', 'jeep', 'joke', 'july', 'jump', 'june',
  'keen', 'keep', 'kelp', 'kind', 'king', 'kite', 'knee', 'knot', 'lace', 'lake',
  'lamp', 'land', 'lane', 'lark', 'lava', 'lawn', 'leaf', 'leap', 'lens', 'life',
  'lift', 'lime', 'line', 'link', 'lion', 'list', 'loaf', 'lock', 'loft', 'lone',
  'loop', 'lung', 'maze', 'meal', 'mesa', 'mild', 'milk', 'mill', 'mint', 'mist',
  'moat', 'mode', 'monk', 'moon', 'moss', 'moth', 'mule', 'muse', 'nail', 'navy',
  'neat', 'neck', 'nest', 'newt', 'nine', 'node', 'noon', 'nose', 'note',
  'oath', 'oats', 'omen', 'opal', 'oval', 'oven', 'pace', 'pack', 'page', 'pail',
  'palm', 'park', 'path', 'peak', 'pear', 'peat', 'pier', 'pike', 'pine', 'pink',
  'pipe', 'plan', 'play', 'plot', 'plow', 'plug', 'plum', 'poem', 'pole', 'pond',
  'pony', 'pool', 'port', 'post', 'pump', 'pure', 'quiz', 'raft', 'rail', 'rain',
  'rake', 'ramp', 'rank', 'rate', 'reed', 'reef', 'rice', 'ride', 'ring', 'ripe',
  'road', 'roam', 'rock', 'role', 'roof', 'room', 'root', 'rope', 'rose', 'ruby',
  'rush', 'rust', 'sage', 'sail', 'salt', 'sand', 'seal', 'seat', 'seed', 'ship',
  'shoe', 'shop', 'silk', 'sing', 'sink', 'site', 'skip', 'sled', 'snow', 'soap',
  'sock', 'sofa', 'soil', 'song', 'soup', 'star', 'stem', 'step', 'stir', 'surf',
  'swan', 'tail', 'tale', 'tank', 'tape', 'taxi', 'team', 'tent', 'tide', 'tile',
  'time', 'toad', 'tone', 'tool', 'town', 'trap', 'tray', 'tree', 'trim', 'trip',
  'tuba', 'tube', 'tuna', 'twig', 'vase', 'vest', 'vine', 'wall', 'wand',
  'wave', 'wick', 'wind', 'wing', 'wolf', 'wood', 'wool', 'yard', 'yarn', 'zero',
  'zone', 'zoom',
].filter((w) => w.length === 4);

/** 3-letter words — used for position 2. */
export const CODE_WORDS_THREE: readonly string[] = [
  'ace', 'ant', 'ape', 'arc', 'arm', 'art', 'ash', 'bag', 'bat', 'bay',
  'bed', 'bee', 'bin', 'bow', 'box', 'bud', 'bug', 'bun', 'bus', 'cab',
  'can', 'cap', 'car', 'cat', 'cod', 'cog', 'cot', 'cow', 'cub', 'cup',
  'dam', 'den', 'dew', 'dig', 'dot', 'dry', 'dug', 'ear', 'eel', 'egg',
  'elk', 'elm', 'fan', 'fig', 'fin', 'fir', 'fix', 'fly', 'fog', 'fox',
  'fun', 'gem', 'gum', 'gut', 'ham', 'hat', 'hay', 'hen', 'hip', 'hog',
  'hop', 'hub', 'hut', 'ice', 'ink', 'ivy', 'jam', 'jar', 'jaw', 'jet',
  'jig', 'job', 'jog', 'jug', 'keg', 'key', 'kid', 'kit', 'lab', 'lap',
  'law', 'leg', 'lid', 'lip', 'log', 'map', 'mat', 'mix', 'mop', 'mud',
  'mug', 'nap', 'net', 'nut', 'oak', 'oar', 'oat', 'oil', 'owl', 'pad',
  'pan', 'paw', 'pea', 'peg', 'pen', 'pet', 'pie', 'pig', 'pin', 'pit',
  'pod', 'pot', 'pup', 'ram', 'rat', 'ray', 'rib', 'rig', 'rim', 'rod',
  'row', 'rug', 'sap', 'saw', 'sea', 'set', 'sky', 'sod', 'spa', 'sun',
  'tab', 'tag', 'tan', 'tap', 'tea', 'ten', 'tie', 'tin', 'tip', 'toe',
  'ton', 'top', 'tow', 'toy', 'tub', 'tug', 'urn', 'van', 'vat', 'vet',
  'vow', 'wax', 'web', 'wig', 'won', 'yak', 'yam', 'yew', 'zip', 'zoo',
].filter((w) => w.length === 3);
