const path = require('path');
const fs = require('fs-extra');
const utils = require('loader-utils');
const sass = require('node-sass');
const scssParser = require('scss-parser');
const createQueryWrapper = require('query-ast');
const isArray = require('lodash/isArray');

function cleanAST(ast) {
  if (isArray(ast)) {
    return ast.map(ast, cleanAST)
  }
  return { type: ast.type, value: ast.value }
}

function transformSASSFile(data) {
  const ast = scssParser.parse(data)
  const $ = createQueryWrapper(ast)

  $().children('declaration').replace((declaration) => {
    const $declaration = $(declaration);
    const $property    = $declaration.children('property').first();
    const $variable    = $property.children('variable').first();

    $declaration.children('value').first().replace((v) => {
        const variableName = $variable.value();
        const valueAST = cleanAST($(v).get(0));
        const arguments = [];
        arguments.push({ type: "string_double", value: variableName })
        arguments.push({ type: "punctuation", value: "," })
        arguments.push(valueAST)
        return {
          type: "function",
          value: [
            { type: "identifier", value: "export_var" },
            { type: "arguments", value: arguments }
          ]
        }
    })
    return declaration;
  })

  return scssParser.stringify($().get(0));
}

function convertSASSValue(v) {
  if (v instanceof sass.types.Boolean) {
    return v.getValue();
  }

  if (v instanceof sass.types.Color) {
    if (1 === v.getA()) {
      return 'rgb(' + v.getR() + ', ' + v.getG() + ', ' + v.getB() + ')';
    }
    else {
      return 'rgba(' + v.getR() + ', ' + v.getG() + ', ' + v.getB() + ', ' + v.getA() + ')';
    }
  }

  if (v instanceof sass.types.List) {
    const list = [];
    for (let i = 0; i < v.getLength(); i += 1) {
      list.push(convertSASSValue(v.getValue(i)));
    }
    return list;
  }

  if (v instanceof sass.types.Map) {
    const map = {};
    for (let i = 0; i < v.getLength(); i += 1) {
      const key = convertSASSValue(v.getKey(i));
      const value = convertSASSValue(v.getValue(i));
      map[key] = value;
    }
    return map;
  }

  if (v instanceof sass.types.Number) {
    return v.getValue();
  }

  if (v instanceof sass.types.Null) {
    return null;
  }

  if (v instanceof sass.types.String) {
    return v.getValue();
  }

  return undefined;
}

function exportSASSValue(vars, name, value) {
  const n = convertSASSValue(name);
  const v = convertSASSValue(value);
  if (n !== undefined || v !== undefined) {
    vars.push([n, v]);
  }
  return value;
}

function createImporter(resourcePath, resolve, deps) {
  return (url, prev, done) => {
    const dir = path.dirname(prev === 'stdin' ? resourcePath : prev);
    resolve(dir, utils.urlToRequest(url), (err, file) => {
      deps.push(file);
      done({ file: file });
    });
  };
}

function parseSASS(data, importer, functions) {
  return new Promise((resolve, reject) => {
    sass.render({
      data: data,
      importer: importer,
      functions: functions,
    }, (err, result) => {
      if (err) { reject(err); return; }
      resolve();
    })
  });
}

function SassVariablesExtract(resourcePath, resolve, sass) {
    const variables = [];
    const dependencies = [];

    try {
      const transformedSass = transformSASSFile(sass)
      const importer = createImporter(resourcePath, resolve, dependencies);
      const exportVar = (name, value) => exportSASSValue(variables, name, value);
      const functions = { export_var: exportVar };
      return parseSASS(transformedSass, importer, functions)
        .then(() => {
          return { variables: variables, dependencies: dependencies };
        })
    } catch(e) {
      return Promise.reject(e)
    }
}

module.exports = SassVariablesExtract;
