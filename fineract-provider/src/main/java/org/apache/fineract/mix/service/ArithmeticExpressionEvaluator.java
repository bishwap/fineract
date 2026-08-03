/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership. The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
package org.apache.fineract.mix.service;

import java.math.BigDecimal;
import java.math.MathContext;

/**
 * Evaluates simple arithmetic expressions made up of decimal numbers, the operators + - * / and parentheses.
 *
 * Anything else (identifiers, function calls, property access, statements) is rejected, so the expression text can
 * never be interpreted as code.
 */
public final class ArithmeticExpressionEvaluator {

    private final String expression;
    private int position;

    private ArithmeticExpressionEvaluator(final String expression) {
        this.expression = expression;
    }

    /**
     * @throws IllegalArgumentException
     *             if the expression is null, empty or contains anything other than numbers, + - * / and parentheses
     */
    public static BigDecimal evaluate(final String expression) {
        if (expression == null || expression.trim().isEmpty()) {
            throw new IllegalArgumentException("Expression is empty");
        }
        final ArithmeticExpressionEvaluator evaluator = new ArithmeticExpressionEvaluator(expression);
        final BigDecimal result = evaluator.parseExpression();
        evaluator.skipWhitespace();
        if (evaluator.position < expression.length()) {
            throw new IllegalArgumentException("Unexpected character '" + expression.charAt(evaluator.position) + "' at position "
                    + evaluator.position + " in expression");
        }
        return result;
    }

    private BigDecimal parseExpression() {
        BigDecimal value = parseTerm();
        while (true) {
            skipWhitespace();
            if (consume('+')) {
                value = value.add(parseTerm());
            } else if (consume('-')) {
                value = value.subtract(parseTerm());
            } else {
                return value;
            }
        }
    }

    private BigDecimal parseTerm() {
        BigDecimal value = parseFactor();
        while (true) {
            skipWhitespace();
            if (consume('*')) {
                value = value.multiply(parseFactor());
            } else if (consume('/')) {
                final BigDecimal divisor = parseFactor();
                if (divisor.signum() == 0) {
                    throw new IllegalArgumentException("Division by zero in expression");
                }
                value = value.divide(divisor, MathContext.DECIMAL64);
            } else {
                return value;
            }
        }
    }

    private BigDecimal parseFactor() {
        skipWhitespace();
        if (consume('+')) {
            return parseFactor();
        }
        if (consume('-')) {
            return parseFactor().negate();
        }
        if (consume('(')) {
            final BigDecimal value = parseExpression();
            skipWhitespace();
            if (!consume(')')) {
                throw new IllegalArgumentException("Missing closing parenthesis in expression");
            }
            return value;
        }
        return parseNumber();
    }

    private BigDecimal parseNumber() {
        final int start = this.position;
        while (this.position < this.expression.length() && isNumberCharacter(this.expression.charAt(this.position))) {
            this.position++;
        }
        if (start == this.position) {
            throw new IllegalArgumentException("Expected a number at position " + this.position + " in expression");
        }
        final String number = this.expression.substring(start, this.position);
        try {
            return new BigDecimal(number);
        } catch (final NumberFormatException e) {
            throw new IllegalArgumentException("Invalid number '" + number + "' in expression", e);
        }
    }

    private boolean isNumberCharacter(final char character) {
        return character >= '0' && character <= '9' || character == '.';
    }

    private boolean consume(final char character) {
        if (this.position < this.expression.length() && this.expression.charAt(this.position) == character) {
            this.position++;
            return true;
        }
        return false;
    }

    private void skipWhitespace() {
        while (this.position < this.expression.length() && Character.isWhitespace(this.expression.charAt(this.position))) {
            this.position++;
        }
    }
}
