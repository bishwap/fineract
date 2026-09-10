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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Minimal, non-Turing-complete arithmetic evaluator for XBRL taxonomy mapping expressions.
 *
 * Grammar (recursive descent):
 *
 * <pre>
 * expression := term (('+' | '-') term)*
 * term       := factor (('*' | '/') factor)*
 * factor     := ('+' | '-') factor | '(' expression ')' | number | '{' glcode '}'
 * </pre>
 *
 * Only numeric literals, GL code placeholders, the four basic operators and parentheses are accepted; anything else is
 * rejected before evaluation.
 */
public final class XBRLMappingExpressionEvaluator {

    private static final Pattern GL_CODE_PATTERN = Pattern.compile("\\{([^{}]*)\\}");
    private static final MathContext MATH_CONTEXT = MathContext.DECIMAL64;

    private final String expression;
    private final Map<String, BigDecimal> balances;
    private int pos;

    private XBRLMappingExpressionEvaluator(final String expression, final Map<String, BigDecimal> balances) {
        this.expression = expression;
        this.balances = balances;
    }

    /**
     * Evaluates the mapping expression, resolving each {glcode} placeholder against the supplied balances (missing
     * codes evaluate to zero).
     */
    public static BigDecimal evaluate(final String expression, final Map<String, BigDecimal> balances) {
        if (expression == null) {
            throw new IllegalArgumentException("Mapping expression must not be null");
        }
        final XBRLMappingExpressionEvaluator evaluator = new XBRLMappingExpressionEvaluator(expression, balances);
        final BigDecimal result = evaluator.parseExpression();
        evaluator.skipWhitespace();
        if (evaluator.pos != expression.length()) {
            throw evaluator.error("Unexpected character");
        }
        return result;
    }

    /**
     * Validates that the expression is syntactically well formed without needing any balances.
     */
    public static void validate(final String expression) {
        evaluate(expression, Map.of());
    }

    public static List<String> extractGLCodes(final String expression) {
        final List<String> codes = new ArrayList<>();
        if (expression != null) {
            final Matcher m = GL_CODE_PATTERN.matcher(expression);
            while (m.find()) {
                codes.add(m.group(1));
            }
        }
        return codes;
    }

    private BigDecimal parseExpression() {
        BigDecimal value = parseTerm();
        while (true) {
            skipWhitespace();
            if (consume('+')) {
                value = value.add(parseTerm(), MATH_CONTEXT);
            } else if (consume('-')) {
                value = value.subtract(parseTerm(), MATH_CONTEXT);
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
                value = value.multiply(parseFactor(), MATH_CONTEXT);
            } else if (consume('/')) {
                final BigDecimal divisor = parseFactor();
                if (divisor.signum() == 0) {
                    throw error("Division by zero");
                }
                value = value.divide(divisor, MATH_CONTEXT);
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
                throw error("Expected ')'");
            }
            return value;
        }
        if (consume('{')) {
            final int start = this.pos;
            while (this.pos < this.expression.length() && this.expression.charAt(this.pos) != '}') {
                if (this.expression.charAt(this.pos) == '{') {
                    throw error("Nested '{' in GL code placeholder");
                }
                this.pos++;
            }
            if (this.pos >= this.expression.length()) {
                throw error("Expected '}'");
            }
            final String glCode = this.expression.substring(start, this.pos);
            this.pos++;
            if (glCode.isEmpty()) {
                throw error("Empty GL code placeholder");
            }
            final BigDecimal balance = this.balances.get(glCode);
            return balance != null ? balance : BigDecimal.ZERO;
        }
        return parseNumber();
    }

    private BigDecimal parseNumber() {
        final int start = this.pos;
        boolean seenDot = false;
        while (this.pos < this.expression.length()) {
            final char c = this.expression.charAt(this.pos);
            if (Character.isDigit(c)) {
                this.pos++;
            } else if (c == '.' && !seenDot) {
                seenDot = true;
                this.pos++;
            } else {
                break;
            }
        }
        final String literal = this.expression.substring(start, this.pos);
        if (literal.isEmpty() || literal.equals(".")) {
            throw error("Expected number");
        }
        return new BigDecimal(literal);
    }

    private boolean consume(final char expected) {
        if (this.pos < this.expression.length() && this.expression.charAt(this.pos) == expected) {
            this.pos++;
            return true;
        }
        return false;
    }

    private void skipWhitespace() {
        while (this.pos < this.expression.length() && Character.isWhitespace(this.expression.charAt(this.pos))) {
            this.pos++;
        }
    }

    private IllegalArgumentException error(final String message) {
        return new IllegalArgumentException(
                "Invalid XBRL mapping expression at position " + this.pos + ": " + message + " in '" + this.expression + "'");
    }
}
