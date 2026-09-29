# Dark Fantasy Icon Pack (96 icons)
One icon per item id in items.json (30 monster parts, 15 consumables, 51 equipment).
File names = item ids, so lookup is `icons/<id>.svg`.

- svg/            framed icons (128x128 viewBox, scalable, ~2-6 KB each)
- svg-noframe/    glyph only, transparent, for your own slot frames
- png/64,128,256  raster exports
- sprites/        items-64.png + items-128.png atlases (+ .json coords), icons.css, icons-sprite.svg (<use href="#icon-ID">)
- manifest.json   id -> name, category, rarity, file paths
- preview.html    open in a browser to see everything

Border colors: common=grey, uncommon=green, rare=blue, epic=purple.
Equipment: t1=common, t2=rare, t3=epic. Consumables have no rarity in your JSON, so
I assigned one by size/tier (edit in manifest.json / regenerate if you disagree).
Sprite CSS: <i class="icon icon-pot_hp_small"></i> (64px cell).
