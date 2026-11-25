// Shrinks exported GLB files: dedupe, quantize vertex data and apply meshopt compression.
// three.js decodes this with GLTFLoader.setMeshoptDecoder(MeshoptDecoder).
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { readFile, writeFile } from 'node:fs/promises';

let io;
async function getIO() {
  if (io) return io;
  await MeshoptEncoder.ready;
  io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  return io;
}

/** Compress one GLB in place. Returns [before, after] byte sizes. */
export async function compressGLB(path) {
  const before = (await readFile(path)).byteLength;
  const io2 = await getIO();
  const doc = await io2.read(path);
  await doc.transform(
    // never merge materials: the placeholders differ only by name (mg_leaf, mg_bark, ...) and the client maps by name
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE, PropertyType.SKIN] }),
    prune({ keepLeaves: true, keepAttributes: true }), // keep empty anchor nodes (fruit attach points)
    reorder({ encoder: MeshoptEncoder }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeWeight: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = await io2.writeBinary(doc);
  await writeFile(path, out);
  return [before, out.byteLength];
}
