import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';

// Adjust paths as needed, e.g. if your wavtools is in /src/lib/wavtools/
export default {
  input: 'src/lib/wavtools/index.js',   // your ESM entry point
  output: {
    file: 'dist/wavtools.umd.js',       // output file
    format: 'umd',                      // produce a UMD build
    name: 'WavTools',                   // global name when loaded via <script>
    amd: {
      id: 'wavtools'                    // the "named" AMD module ID
    },
    exports: 'named',
    sourcemap: false
  },
  plugins: [
    nodeResolve({
      // if you have browser-based code, you can do:
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    terser()  // optional minification
  ]
};
