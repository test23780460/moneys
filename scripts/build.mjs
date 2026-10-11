import {cp, mkdir, rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist');
await Promise.all([
  cp('index.html','dist/index.html'),
  cp('styles.css','dist/styles.css'),
  cp('.nojekyll','dist/.nojekyll'),
  cp('src','dist/src',{recursive:true}),
]);
console.log('Static site ready in dist/');
