const test = require('node:test');
const assert = require('node:assert/strict');
const {
    isValidEmail,
    isValidPhone,
    validateEmail,
    validatePhone,
} = require('../utils/validators');

test('isValidEmail accepts standard formats with surrounding whitespace and rejects malformed input', () => {
    assert.equal(isValidEmail('reader@library.com'), true);
    assert.equal(isValidEmail('  admin.user+tag@uni.edu.vn  '), true);
    assert.equal(isValidEmail('invalid-email'), false);
    assert.equal(isValidEmail('missing@domain'), false);
    assert.equal(isValidEmail(''), false);
    assert.equal(isValidEmail(null), false);
});

test('validateEmail returns descriptive validation states', () => {
    assert.deepEqual(validateEmail('   '), {
        isValid: false,
        message: 'Email không được để trống',
    });
    assert.equal(validateEmail('not-an-email').isValid, false);
    assert.deepEqual(validateEmail('owner@library.com'), { isValid: true });
});

test('isValidPhone supports 0xxxxxxxxx, +84xxxxxxxxx, and 84xxxxxxxxx Vietnamese numbers', () => {
    assert.equal(isValidPhone('0912345678'), true);
    assert.equal(isValidPhone('+84912345678'), true);
    assert.equal(isValidPhone('84912345678'), true);
    assert.equal(isValidPhone('0912abc678'), false);
    assert.equal(isValidPhone('091234567'), false);
    assert.equal(isValidPhone('1912345678'), false);
});

test('validatePhone handles optional vs required fields and rejects letters', () => {
    assert.deepEqual(validatePhone('', false), { isValid: true });
    assert.deepEqual(validatePhone('', true), {
        isValid: false,
        message: 'Số điện thoại không được để trống',
    });
    assert.equal(validatePhone('0912abcd78', true).isValid, false);
    assert.deepEqual(validatePhone('0987654321', true), { isValid: true });
});

