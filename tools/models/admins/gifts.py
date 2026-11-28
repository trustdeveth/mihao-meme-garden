"""Packs one gift zip per admin cat into output/gifts, from the models and pictures already built.

    python tools/models/admins/gifts.py      (run build.mjs and memes.mjs first)
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MODELS = ROOT / 'output' / 'models' / 'admins'
MEMES = ROOT / 'output' / 'memes'
OUT = ROOT / 'output' / 'gifts'
OUT.mkdir(parents=True, exist_ok=True)

# parts of a model that can be hidden on their own, for the looks that have them
EXTRAS = {
    '01-green-hoodie': 'The smoking item is separate: hide the parts whose names start with "smoke_prop".',
    '09-pink-hair': 'The cigarette and shirt stain are separate: hide the parts whose names start with "smoke_prop" or "stain_prop".',
}


def guide(name, title, files):
    lines = [
        f'YOUR MIHAO CAT: {title}',
        'A gift from Mihao Meme Garden.',
        '',
        "WHAT'S INSIDE",
        *[f'  {inside}\n      {what}' for inside, _, what in files],
        '',
        'PICTURES',
        '  Open them like any photo. For a profile picture, use profile-picture.png and check',
        '  the crop before saving: a circle may cut off a tall hat or ears.',
        '',
        '3D MODEL (.glb)',
        '  A common 3D format. In Blender: File > Import > glTF 2.0.',
        '  It was tested with the 3D library the game uses (three.js), not with other apps,',
        '  so colours or lighting may look a little different elsewhere.',
        '  It includes animations such as idle, walk, run, wave and dance, plus "signature",',
        '  the pose in your pictures.',
    ]
    if name in EXTRAS:
        lines += ['  ' + EXTRAS[name], '  The pictures in the "clean" folder already leave them out.']
    if name in ('05-team-china', '06-lucky-dice', '11-ansem'):
        lines += ['  The item you hold stays with the body, so it does not follow your paw in every animation.']
    lines += ['', 'mihaomeme.garden   #MihaoGarden', '']
    return '\r\n'.join('\n'.join(lines).split('\n'))


for model in sorted(MODELS.glob('*.glb')):
    name = model.stem
    title = name[3:].replace('-', ' ').title()
    files = [
        (f'mihao-{name[3:]}.glb', model, 'your 3D cat, with animations'),
        ('profile-picture.png', MEMES / 'pfp' / f'{name}.png', 'in the garden, no words (2048 x 2048)'),
        ('meme.jpg', MEMES / 'captioned' / f'{name}.jpg', 'in the garden, with a meme line (2048 x 2048)'),
        ('portrait.png', MODELS / 'pictures' / f'{name}-portrait.png', 'close-up in the classic hallway'),
        ('full-body.png', MODELS / 'pictures' / f'{name}-full.png', 'head to paws'),
    ]
    if name in EXTRAS:
        files += [
            ('clean/profile-picture.png', MEMES / 'clean' / f'{name}-pfp.png', 'profile picture without the extra items'),
            ('clean/meme.jpg', MEMES / 'clean' / f'{name}-captioned.jpg', 'meme without the extra items'),
        ]
    missing = [str(p) for _, p, _ in files if not p.is_file()]
    if missing:
        raise SystemExit(f'missing for {name}: {missing}')
    target = OUT / f'mihao-gift-{name}.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for inside, source, _ in files:
            z.write(source, inside)
        z.writestr('READ-ME.txt', guide(name, title, files).encode('utf-8-sig'))
    with zipfile.ZipFile(target) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f'damaged file in {target.name}: {bad}')
        print(f'{target.name}  {target.stat().st_size / 1048576:.1f} MB  {len(z.namelist())} files')
