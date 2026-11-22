import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const d = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(process.argv[2]);
for (const n of d.getRoot().listNodes()) if (n.getMesh()) { const b = getBounds(n); console.log(n.getName(), b.min.map(x=>+x.toFixed(2)), b.max.map(x=>+x.toFixed(2)), n.getMesh().listPrimitives().map(p=>p.getMaterial()?.getName()+(p.getMaterial()?.getBaseColorTexture()?'(t)':'')).join(',')); }
