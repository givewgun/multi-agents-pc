import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, extractJson } from '../src/bench/tasks.js';
import { RULES } from '../src/router.js';

const task = (id) => TASKS.find((t) => t.id === id);
const js = (code) => '```js\n' + code + '\n```';

describe('bench graders', () => {
  it('extractJson handles fences, prose and arrays', () => {
    assert.deepEqual(extractJson('Here: ```json\n{"a":1}\n``` done'), { a: 1 });
    assert.deepEqual(extractJson('answer is {"line": 5} ok'), { line: 5 });
    assert.deepEqual(extractJson('["x","y"]'), ['x', 'y']);
    assert.equal(extractJson('nothing'), undefined);
  });

  it('regex', () => {
    const t = task('trivial-regex');
    assert.equal(t.grade('/^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$/').pass, true);
    assert.equal(t.grade('/^\\d{4}-\\d{2}-\\d{2}$/').pass, false);
  });

  it('slugify', () => {
    const t = task('boilerplate-slugify');
    const good = `function slugify(s){return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}`;
    assert.equal(t.grade(js(good)).pass, true);
    assert.equal(t.grade(js(`function slugify(s){return s.toLowerCase().replace(/ /g,'-');}`)).pass, false);
  });

  it('off-by-one review', () => {
    const t = task('review-offbyone');
    assert.equal(t.grade('{"line": 5, "fix": "for (let i = start; i < arr.length; i++) {"}').pass, true);
    assert.equal(t.grade('{"line": 4, "fix": "x"}').pass, false);
  });

  it('concurrency', () => {
    const t = task('hard-concurrency');
    assert.equal(t.grade('{"min": 2, "max": 20}').pass, true);
    assert.equal(t.grade('{"min": 10, "max": 20}').pass, false);
  });

  it('lru fix', () => {
    const t = task('hard-lru-fix');
    const fixed = `class LRU {
      constructor(c){this.cap=c;this.map=new Map();}
      get(k){ if(!this.map.has(k)) return -1; const v=this.map.get(k); this.map.delete(k); this.map.set(k,v); return v; }
      put(k,v){ if(this.map.has(k)) this.map.delete(k); else if(this.map.size>=this.cap) this.map.delete(this.map.keys().next().value); this.map.set(k,v); }
    }`;
    assert.equal(t.grade(js(fixed)).pass, true);
    const buggy = /```js\n([\s\S]*?)```/.exec(t.prompt)[1];
    assert.equal(t.grade(js(buggy)).pass, false);
  });

  it('expression evaluator', () => {
    const t = task('feature-expr-eval');
    const ref = `function evaluate(src){
      let i=0; const s=src;
      const ws=()=>{while(i<s.length&&/\\s/.test(s[i]))i++;};
      const num=()=>{ws(); const m=/^\\d+(\\.\\d+)?/.exec(s.slice(i)); if(!m) throw new Error('num'); i+=m[0].length; return parseFloat(m[0]);};
      const unary=()=>{ws(); if(s[i]==='-'){i++; return -unary();} if(s[i]==='('){i++; const v=expr(); ws(); if(s[i]!==')') throw new Error(')'); i++; return v;} return num();};
      const term=()=>{let v=unary(); for(;;){ws(); if(s[i]==='*'){i++; v*=unary();} else if(s[i]==='/'){i++; v/=unary();} else return v;}};
      const expr=()=>{let v=term(); for(;;){ws(); if(s[i]==='+'){i++; v+=term();} else if(s[i]==='-'){i++; v-=term();} else return v;}};
      const v=expr(); ws(); if(i!==s.length) throw new Error('trailing'); return v;
    }`;
    assert.equal(t.grade(js(ref)).pass, true, t.grade(js(ref)).why);
    assert.equal(t.grade(js('function evaluate(e){return eval(e);}')).pass, false);
  });

  it('agentic repo read matches RULES', () => {
    const t = task('agentic-repo-read');
    assert.equal(t.grade(JSON.stringify(RULES.map((r) => r.category))).pass, true);
    assert.equal(t.grade('["x"]').pass, false);
  });
});
