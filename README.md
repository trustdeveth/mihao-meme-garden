# Meme Garden (multiplayer, Phase 1)

A free, server-authoritative multiplayer 3D garden game. No wallet, token or smart contract: the web3 layer comes later (see `../gametokenomics.md`). The old single-player demo stays untouched in `../meme-garden-demo`.

## The Mihao look

The game keeps every rule, feature and tokenomics unchanged; only the art is Mihao-style Roblox:

- **Blocky everything**: `tools/models/lib/geo.js` has a `STYLE` switch (`blocky`, `pop`). With it on, every procedural shape (crops, props, animals) is built from boxes, flat-shaded and a little more saturated. Set `STYLE.blocky = false` to get the old smooth models back.
- **Mihao** is the player: a rounded ginger cat head with a photo face, separate 3D eyebrows, long thin moustache and pointed beard, on a blocky body in a red and gold jacket and shorts with white paws (`tools/models/mihao.js`). No hat by default; the official hat is a free wardrobe item. Mesh names are unchanged (`farmer_skin`, `farmer_shirt`, `hat_cap`, ...), so the avatar editor and wearables still work. **The face comes from a meme picture whose rights have not been checked:** see `tools/models/source/README-mihao-head.md` before any public release.
- **Vendors and pets**: all four shopkeepers are blocky Mihao cats in their own outfits (still the earlier pixel-face style), and the dog, bunny and capybara wear tiny official hats.
- **Wardrobe** (`tools/models/wardrobe.js`): meme outfits with their own shapes (hoods, wings, coats, shoes), six moustache styles and cat fur colours. Items are original designs, bought with coins; the catalogue is `WEAR` in `shared/src/data/features.js`. `npm run models -- --only farmer` also redraws the item pictures (`client/public/icons/wear.webp`).
- **Look and feel only:** weather effects (`client/src/scene/sky.js`), village map (`client/src/ui/map.js`; click the round map for the big one) and action animations (`client/src/fx/`).
- **World**: Roblox baseplate studs on the grass, red lacquer fences and lanterns, a red-and-gold paifang for each garden gate, a golden Mihao statue on the fountain, jade-roofed homes, and drifting block clouds. UI colours are lacquer red, imperial gold and jade (`client/src/ui/theme.css`).

Rebuild the art with `npm run models` and `npm run icons`, then `npm run build`.

## Meme features

Cosmetic only: none of them gives coins, gems, reputation, Season Points or MGRD.

- **Mihao Cam** (Cam button or **G**): four free poses plus two bought with Meme Points, speech bubbles from a fixed list, a pose-booth camera, **P** photo (bubbles included, `#MihaoGarden` watermark), clip recording (up to 15 s, no sound), **H** hide the interface.
- **Auto moments**: rare harvest, weather changes, selling 15+ fruit, standing idle, meeting a neighbour. At most one every 45 s, moving ends the pose, and each player can switch them off.
- **Beard Battle** (random) and **Pointing Contest** (**Q**, reaction time): with a nearby player, who must accept, or against Gus at the Market.
- **Official Inspection**: an inspector visits every 15 to 25 minutes online; pass with 3 or more plants.
- **Mihao stamps**: the old garden like, now with a stamp effect and a guestbook (Menu > Stamps).
- **Meme Points**: rare harvest 3, leaving a stamp 2, passed inspection 15, contest win 5 (2 against Gus), at most 60 a day. They only unlock poses.
- **Instant replay** (off by default; Mihao Cam > Instant replay): **L** or **Save last moment** keeps the last 7.5 to 15 seconds (less just after switching it on). It records continuously while on, so it uses more power. It stops while the tab is hidden.
- **Post to X** (**X**, or the button in Mihao Cam): makes a meme picture (a close-up of your cat's face, or the view on screen) with a caption and one of four styles. On a computer, X's post link cannot carry a file, so the game uploads the picture to its server (`server/src/share.js`, pages at `/api/s/<id>`) and puts that link in the post; X shows the picture as a large link preview. It also copies the picture, so the player can paste it to attach it as a photo. This needs a public https address (`MG_PUBLIC_URL`, or the first public one in `MG_ORIGINS`). Uploads are JPEG only, rate limited, 20 per player and 2,000 in total (oldest removed); moderate with `npm run shares -- list|delete <id>|delete-player <name>`, or switch off with `MG_SHARE=0`. On a phone it uses the share menu. A small "Post this to X" button appears after big moments (it follows the Auto moments switch). The player always presses Post themselves; the game holds no X login or key and gives no reward for posting. Set `VITE_SHARE_URL` to choose the link added to posts (by default the site's own https address; local addresses are left out).
- **Weekly Meme Challenge** (Menu): a new prompt each week. Players post on X and paste the link into the challenge panel (one entry each per week). Nothing is public until a moderator approves it:
  ```bash
  npm run challenge -- list                # entries waiting this week
  npm run challenge -- feature 3           # show entry 3 to everyone
  npm run challenge -- reject 3            # refuse it, or take a featured one down
  ```
  Run this on the machine that holds the game database (`--db` or `MG_DB` for another path). Hand-picked posts can still go in `server/data/featured.json`: `[{"week":"YYYY-MM-DD (Monday)","title":"...","by":"...","url":"https://x.com/name/status/123"}]`.

Check the meme features in two headless browsers with `npm run build` then `npm run e2e:memes`.

**Mihao names:** crops and homes have Mihao names, and Garden Rebirth is shown as **Promotion** (Rank Stars). Only display text changed: ids such as `carrot`, `treehouse` and `rebirth` are unchanged, so saved gardens keep working.

## Run it

```bash
npm install
npm run models      # build all 3D models, textures and review renders (headless Chrome, ~30 s)
npm run icons       # UI icon sprite + crop icons rendered from the models
npm run dev         # server on :8850 + client on http://127.0.0.1:5190
```

Production-style: `npm run build` then `npm start` (the server also serves `client/dist` on http://127.0.0.1:8850).

Requirements: Node 22.5+ (tested on 24), Google Chrome at the default path for the model tools and browser tests (or set `CHROME_PATH`).

## Layout

| Folder | What it is |
|---|---|
| `shared/` | Pure game rules and data used by the server, the client and the tools: crop table v3, free planting and spacing, buddies, exact growth integration over weather windows, ripening rolls (2 per cycle), ripeness, variants, Market Mood, restocks, gadgets, Grow All, pity help, quests, 7-day gift, offline catch-up |
| `server/` | Fastify + WebSocket. Guest accounts (httpOnly cookie + recovery code), short-lived socket tickets, rooms of 12 plots, idempotent actions, reach and movement checks, rate limits, chat filter, likes, write-behind SQLite (`node:sqlite`) |
| `client/` | Vite + three.js. Village scene, 12 plots with soil levels, plant renderer (stages, LOD, fruit looks), rigged characters, click-to-walk, placement preview, trowel, vendors' dialogue, shops, basket, quests, gift, chat, minimap, "Sunny Meadow" HUD with a custom icon sprite |
| `tools/models/` | Procedural model generators (29 crops x 5 stages x 2 LODs + fruit, 4 rigged characters, 18 props), canvas textures, GLB export, meshopt compression, review renders |
| `tools/icons/` | Hand-drawn SVG UI icons (validated) and the crop icon atlas |
| `tools/budget/` | Triangle and file-size budget check for every model |
| `tools/load/` | Load test with bots |
| `e2e/` | Browser tests with two players |

## Tests

```bash
npm test             # shared rules + server integration + model budgets
npm run lint:ui      # no emoji/symbol icons, no grey text, minimum text sizes
npm run e2e          # two browsers: plant, chat, harvest, sell + every feature panel, daily challenge, friends (server must be running)
npm run showcase     # throwaway server with a rich garden: screenshots of home, decor, pets, eggs, Sky Island
npm run load -- 8 25 # 96 bots for 25 s
```

## Controls

WASD / arrows to move (walk 3.2 m/s), Shift to run (6.2 m/s; long click-walks run too), Space to jump, E to interact, drag to look, wheel to zoom, 1-9 for the hotbar, Enter to chat, R to rotate a decoration while placing it, Esc to stop placing. Click soil with a seed selected to plant there; click a plant to harvest, water (can), move (trowel) or remove (shovel). Mobile: joystick, E and Jump buttons.

## Game features

- **Pets**: eggs from Penny Paws at the Pet Shop (plaza, or the Pets tab), they warm in nests next to your home. Up to 3 pets help at once (water or harvest), also while you are away (8 h cap). Train them with bond + coins; harvesters can be Speedy or Patient (wait for Peak).
- **Home**: 5 tiers from Clerk's Hut to Imperial Sky Palace, each a permanent bonus on every sale. Before you build, a "Home Spot" sign marks the place behind your soil; press E there.
- **Decorations**: bought from Mo (Decorations tab), placed anywhere in your fence off the soil (ghost preview, R to rotate), moved or packed away from Menu > Decor.
- **Album, badges and titles**: every crop, variant, weather mark and BIG size is a sticker; 12 collections pay gems and titles shown on your nametag.
- **Requirement checklists**: Expand Soil, Rebirth, the balloon, home, orders, contract, quests and collections show a tick or an empty box per requirement with have / need.
- **Village Board** (plaza): 3 villager orders (2 h each) and a weekly contract; they raise your reputation level.
- **Season pass**: 30 free tiers of season XP from harvesting.
- **Festivals**: every weekend (UTC), festive mutation, tickets and a ticket shop.
- **Sky Island**: fix Captain Puff's balloon (10 Fortune Pumpkins + 5 Lucky Bamboo), find 10 Sky Acorns a day, trade them at the owl.
- **Daily Challenge**: same tools for everyone, three rotating formats, medals, gems and reputation.
- **Surprises**: crows, gnomes and lost aliens visit your garden; press E to deal with them.
- **Promotion** (rebirth): full soil + Magistrate's Treehouse resets the garden for a permanent Rank Star (+5% sales each).
- **Avatar editor, friends** (codes, join a friend's village), **mute/report**, **postcards**, **sound and music**, **Magnifier values** and **buddy hearts** on plant labels.

## MGRD token layer (optional, not deployed)

A Solana program for weekly MGRD reward claims and MGRD-shop payments, with wallet linking, Season Points and a
Rewards panel in the game (Menu > MGRD Rewards). It stays off until the server has `MG_PROGRAM_ID` and
`MG_MGRD_MINT`. Build, local testing, deployment and weekly operations: see [chain/README.md](chain/README.md).

## Deploy the client on Vercel (game server elsewhere)

Vercel serves the game files; the game server (`server/`, WebSockets + SQLite) runs on a normal host such as
Fly.io, Railway, Render or a VPS. Vercel forwards `/api/*` to that server (so cookies stay first-party); the live
game connection goes straight to the server because Vercel cannot forward WebSockets.

1. Deploy the game server first and note its HTTPS address, e.g. `https://game-api.example.com`. Start it with
   `MG_ORIGINS=https://<your-vercel-domain>` (plus any custom domain) so it accepts the game connection from Vercel,
   and `NODE_ENV=production`, `MG_SECRET=<long random string>`.
2. In `vercel.json` replace `YOUR-GAME-SERVER` with that address (without `https://` and without a trailing slash).
3. On Vercel: New Project -> import the repo -> **Root Directory = `solana-garden-plan/meme-garden`** (the folder
   with `vercel.json`). Framework preset: Other. Build settings come from `vercel.json`.
4. Environment variable on Vercel: `VITE_WS_URL = wss://game-api.example.com/ws`.
5. Deploy. Open the Vercel URL; the loading screen should join a village.
