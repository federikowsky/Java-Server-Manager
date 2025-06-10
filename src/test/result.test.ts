/*
 * Basic tests for Result utilities using Mocha TDD syntax
 */

import * as assert from 'assert';
import { ok, err, Result, map, mapErr, andThen, fromPromise } from '../core/utils/result';

suite('Result Utilities', () => {
    
    suite('Basic Result Creation', () => {
        
        test('should create ok result', () => {
            const result = ok(42);
            assert.strictEqual(result.ok, true);
            if (result.ok) {
                assert.strictEqual(result.value, 42);
            }
        });
        
        test('should create error result', () => {
            const result = err('something went wrong');
            assert.strictEqual(result.ok, false);
            if (!result.ok) {
                assert.strictEqual(result.error, 'something went wrong');
            }
        });
        
    });
    
    suite('Result Transformations', () => {
        
        test('map should transform ok value', () => {
            const result = ok(5);
            const mapped = map(result, x => x * 2);
            
            assert.strictEqual(mapped.ok, true);
            if (mapped.ok) {
                assert.strictEqual(mapped.value, 10);
            }  
        });
        
        test('map should preserve error', () => {
            const result = err('error');
            const mapped = map(result, (x: number) => x * 2);
            
            assert.strictEqual(mapped.ok, false);
            if (!mapped.ok) {
                assert.strictEqual(mapped.error, 'error');
            }
        });
        
        test('mapErr should transform error', () => {
            const result = err('original error');
            const mapped = mapErr(result, e => `transformed: ${e}`);
            
            assert.strictEqual(mapped.ok, false);
            if (!mapped.ok) {
                assert.strictEqual(mapped.error, 'transformed: original error');
            }
        });
        
        test('mapErr should preserve ok value', () => {
            const result = ok(42);
            const mapped = mapErr(result, e => `transformed: ${e}`);
            
            assert.strictEqual(mapped.ok, true);
            if (mapped.ok) {
                assert.strictEqual(mapped.value, 42);
            }
        });
        
    });
    
    suite('Result Chaining', () => {
        
        test('andThen should chain ok results', () => {
            const result = ok(5);
            const chained = andThen(result, (x: number) => ok(x.toString()));
            
            assert.strictEqual(chained.ok, true);
            if (chained.ok) {
                assert.strictEqual(chained.value, '5');
            }
        });
        
        test('andThen should stop on first error', () => {
            const result = err('first error');
            const chained = andThen(result, (x: number) => ok(x.toString()));
            
            assert.strictEqual(chained.ok, false);
            if (!chained.ok) {
                assert.strictEqual(chained.error, 'first error');
            }
        });
        
        test('andThen should propagate chained error', () => {
            const result = ok(5);
            const chained = andThen(result, x => err('chained error'));
            
            assert.strictEqual(chained.ok, false);
            if (!chained.ok) {
                assert.strictEqual(chained.error, 'chained error');
            }
        });
        
    });
    
    suite('Promise Integration', () => {
        
        test('fromPromise should handle resolved promise', async () => {
            const promise = Promise.resolve(42);
            const result = await fromPromise(promise, e => String(e));
            
            assert.strictEqual(result.ok, true);
            if (result.ok) {
                assert.strictEqual(result.value, 42);
            }
        });
        
        test('fromPromise should handle rejected promise', async () => {
            const promise = Promise.reject(new Error('test error'));
            const result = await fromPromise(promise, e => e instanceof Error ? e.message : String(e));
            
            assert.strictEqual(result.ok, false);
            if (!result.ok) {
                assert.strictEqual(result.error, 'test error');
            }
        });
        
    });
    
});
