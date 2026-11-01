// webpack.config.js
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const pkg = require('./package.json');

module.exports = (env = {}) => {
  const targetBrowser = env.browser || process.env.TARGET_BROWSER || 'chrome';
  const isFirefox = targetBrowser === 'firefox';
  const outDir = env.outDir || (isFirefox ? 'dist-firefox' : 'dist');
  const manifestFile = isFirefox ? 'manifest.firefox.json' : 'manifest.json';

  return {
    mode: 'development',
    devtool: 'cheap-module-source-map',
    entry: {
      background: './src/background/background.ts',
      content: './src/content/content.ts',
      injected: './src/injected/injected.ts',
      popup: './src/popup/popup.ts',
      options: './src/options/options.ts',
      editor: './src/editor/editor.ts',
      unlock: './src/unlock/unlock.ts'
    },
    output: {
      path: path.resolve(__dirname, outDir),
      filename: '[name]/[name].js'
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        },
        {
          test: /\.md$/,
          type: 'asset/source'
        }
      ]
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          {
            from: manifestFile,
            to: 'manifest.json',
            transform(content) {
              const manifest = JSON.parse(content.toString());
              if (pkg.version) manifest.version = pkg.version;
              if (pkg.displayName || pkg.name) manifest.name = pkg.displayName || pkg.name;
              if (pkg.description) manifest.description = pkg.description;
              return JSON.stringify(manifest, null, 2);
            }
          },
          { from: 'icons', to: 'icons' },
          { from: 'src/content/presentation/styles/style.css', to: 'content/style.css' },
          { from: 'src/shared/utils/rules.json', to: 'utils/rules.json' },
          { from: 'src/options/options.html', to: 'options/options.html' },
          { from: 'src/options/options.css', to: 'options/options.css' },
          { from: 'src/popup/popup.html', to: 'popup/popup.html' },
          { from: 'src/popup/popup.css', to: 'popup/popup.css' },
          { from: 'src/editor/editor.html', to: 'editor/editor.html' },
          { from: 'src/editor/editor.css', to: 'editor/editor.css' },
          { from: 'src/unlock/unlock.html', to: 'unlock/unlock.html' },
          { from: 'src/unlock/unlock.css', to: 'unlock/unlock.css' },
          { from: 'node_modules/kuromoji/dict', to: 'dict' }
        ]
      })
    ],
    resolve: {
      extensions: ['.ts', '.js'],
      fallback: {
        path: require.resolve('path-browserify')
      },
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
        '@background': path.resolve(__dirname, 'src/background'),
        '@content': path.resolve(__dirname, 'src/content'),
        '@popup': path.resolve(__dirname, 'src/popup'),
        '@options': path.resolve(__dirname, 'src/options'),
        '@injected': path.resolve(__dirname, 'src/injected'),
        '@unlock': path.resolve(__dirname, 'src/unlock')
      }
    }
  };
};
