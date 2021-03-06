import loaderUtils from 'loader-utils';
import path from 'path';
import Promise from 'bluebird';
import fs from 'fs-extra';

const constants = Promise.promisifyAll(require('constants')); // eslint-disable-line import/no-commonjs

export default function writeFile(globalRef, pattern, file) {
  const {
    info,
    debug,
    compilation,
    fileDependencies,
    written,
    copyUnmodified,
  } = globalRef;

  return fs.stat(file.absoluteFrom)
    .then((stat) => {
      // We don't write empty directories
      if (stat.isDirectory()) {
        return Promise.resolve();
      }

      // If this came from a glob, add it to the file watchlist
      if (pattern.fromType === 'glob') {
        fileDependencies.push(file.absoluteFrom);
      }

      info(`reading ${file.absoluteFrom} to write to assets`);
      return fs.readFile(file.absoluteFrom)
        .then((content) => {
          if (pattern.transform) {
            content = pattern.transform(content, file.absoluteFrom);
          }

          const hash = loaderUtils.getHashDigest(content);

          if (pattern.toType === 'template') {
            info(`interpolating template '${file.webpackTo}' for '${file.relativeFrom}'`);

            // A hack so .dotted files don't get parsed as extensions
            const basename = path.basename(file.relativeFrom);
            let dotRemoved = false;
            if (basename[0] === '.') {
              dotRemoved = true;
              file.relativeFrom = path.join(path.dirname(file.relativeFrom), basename.slice(1));
            }

            // If it doesn't have an extension, remove it from the pattern
            // ie. [name].[ext] or [name][ext] both become [name]
            if (!path.extname(file.relativeFrom)) {
              file.webpackTo = file.webpackTo.replace(/\.?\[ext\]/g, '');
            }

            // A hack because loaderUtils.interpolateName doesn't
            // find the right path if no directory is defined
            // ie. [path] applied to 'file.txt' would return 'file'
            if (file.relativeFrom.indexOf(path.sep) < 0) {
              file.relativeFrom = path.sep + file.relativeFrom;
            }

            file.webpackTo = loaderUtils.interpolateName(
              {
                resourcePath: file.relativeFrom,
              },
              file.webpackTo, {
                content,
              },
            );

            // Add back removed dots
            if (dotRemoved) {
              const newBasename = path.basename(file.webpackTo);
              file.webpackTo = `${path.dirname(file.webpackTo)}/.${newBasename}`;
            }
          }

          if (!copyUnmodified &&
            written[file.absoluteFrom] && written[file.absoluteFrom][hash]) {
            info(`skipping '${file.webpackTo}', because it hasn't changed`);
            return;
          }

          debug(`added ${hash} to written tracking for '${file.absoluteFrom}'`);
          written[file.absoluteFrom] = {
            [hash]: true,
          };

          if (compilation.assets[file.webpackTo] && !file.force) {
            info(`skipping '${file.webpackTo}', because it already exists`);
            return;
          }

          let perms;
          if (pattern.copyPermissions) {
            debug(`saving permissions for '${file.absoluteFrom}'`);

            written[file.absoluteFrom].copyPermissions = pattern.copyPermissions;
            written[file.absoluteFrom].webpackTo = file.webpackTo;

            const constsfrom = fs.constants || constants;

            perms |= stat.mode & constsfrom.S_IRWXU;
            perms |= stat.mode & constsfrom.S_IRWXG;
            perms |= stat.mode & constsfrom.S_IRWXO;

            written[file.absoluteFrom].perms = perms;
          }

          info(`writing '${file.webpackTo}' to compilation assets from '${file.absoluteFrom}'`);
          compilation.assets[file.webpackTo] = {
            size() {
              return stat.size;
            },
            source() {
              return content;
            },
          };
        });
    });
}
