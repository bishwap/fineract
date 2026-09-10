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
package org.apache.fineract.portfolio.savings.service;

import com.google.common.base.Splitter;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.apache.fineract.infrastructure.security.utils.SQLInjectionException;

/**
 * Parses the {@code sqlSearch}, {@code orderBy} and {@code sortOrder} parameters of the savings account listing
 * endpoint into a restricted SQL fragment. Instead of concatenating the raw request values into the query, the
 * {@code sqlSearch} expression is parsed into a small predicate grammar ({@code column <op> literal} combined with
 * {@code AND}/{@code OR} and parentheses), every column reference is resolved against a fixed allowlist and every
 * literal is emitted as a {@code ?} bind parameter. Anything outside this grammar is rejected with
 * {@link SQLInjectionException}.
 */
final class SavingsAccountQueryParser {

    private SavingsAccountQueryParser() {

    }

    private enum TokenType {
        IDENTIFIER, NUMBER, STRING, OPERATOR, LEFT_PAREN, RIGHT_PAREN, COMMA, AND, OR, NOT, IS, NULL, LIKE, IN, TRUE, FALSE, END
    }

    private static final class Token {

        final TokenType type;
        final String text;

        Token(final TokenType type, final String text) {
            this.type = type;
            this.text = text;
        }
    }

    /**
     * Parsed {@code sqlSearch} predicate: a {@code ?}-parameterized SQL fragment plus the bind values in order.
     */
    static final class ParsedCriteria {

        private final StringBuilder sql = new StringBuilder();
        private final List<Object> parameters = new ArrayList<>();

        String sql() {
            return sql.toString();
        }

        List<Object> parameters() {
            return parameters;
        }
    }

    private static final Set<String> SAVINGS_ACCOUNT_COLUMNS = new HashSet<>(Arrays.asList("id", "account_no", "external_id",
            "deposit_type_enum", "status_enum", "sub_status_enum", "submittedon_date", "rejectedon_date", "withdrawnon_date",
            "approvedon_date", "activatedon_date", "closedon_date", "currency_code", "nominal_annual_interest_rate",
            "interest_compounding_period_enum", "interest_posting_period_enum", "interest_calculation_type_enum",
            "interest_calculation_days_in_year_type_enum", "min_required_opening_balance", "lockin_period_frequency",
            "lockin_period_frequency_enum", "withdrawal_fee_for_transfer", "allow_overdraft", "overdraft_limit",
            "nominal_annual_interest_rate_overdraft", "min_overdraft_for_interest_calculation", "total_deposits_derived",
            "total_withdrawals_derived", "total_withdrawal_fees_derived", "total_annual_fees_derived", "total_interest_earned_derived",
            "total_interest_posted_derived", "total_overdraft_interest_derived", "account_balance_derived", "total_fees_charge_derived",
            "total_penalty_charge_derived", "min_balance_for_interest_calculation", "min_required_balance", "enforce_min_required_balance",
            "on_hold_funds_derived", "withhold_tax", "total_withhold_tax_derived", "last_interest_calculation_date",
            "total_savings_amount_on_hold", "tax_group_id", "product_id", "client_id", "group_id", "field_officer_id", "submittedon_userid",
            "rejectedon_userid", "withdrawnon_userid", "approvedon_userid", "activatedon_userid", "closedon_userid", "version_no"));

    private static final Set<String> CLIENT_COLUMNS = new HashSet<>(
            Arrays.asList("id", "account_no", "display_name", "external_id", "office_id", "status_enum", "firstname", "lastname",
                    "mobile_no", "activation_date", "submittedon_date", "staff_id", "is_staff"));

    private static final Set<String> GROUP_COLUMNS = new HashSet<>(Arrays.asList("id", "account_no", "display_name", "external_id",
            "office_id", "status_enum", "activation_date", "submittedon_date", "staff_id", "parent_id"));

    private static final Set<String> STAFF_COLUMNS = new HashSet<>(Arrays.asList("id", "display_name", "external_id", "firstname",
            "lastname", "office_id", "is_loan_officer", "is_active", "joining_date"));

    private static final Set<String> SAVINGS_PRODUCT_COLUMNS = new HashSet<>(
            Arrays.asList("id", "name", "short_name", "description", "currency_code", "nominal_annual_interest_rate",
                    "is_dormancy_tracking_active", "days_to_inactive", "days_to_dormancy", "days_to_escheat"));

    private static final Set<String> OFFICE_COLUMNS = new HashSet<>(
            Arrays.asList("id", "name", "external_id", "hierarchy", "opening_date", "parent_id"));

    private static final Set<String> CURRENCY_COLUMNS = new HashSet<>(
            Arrays.asList("code", "name", "decimal_places", "display_symbol", "internationalized_name_code"));

    private static final Set<String> TAX_GROUP_COLUMNS = new HashSet<>(Arrays.asList("id", "name"));

    private static final Set<String> APP_USER_COLUMNS = new HashSet<>(Arrays.asList("id", "username", "firstname", "lastname"));

    private static final Map<String, Set<String>> TABLE_COLUMNS;
    private static final Map<String, String> COLUMN_ALIASES;

    static {
        final Map<String, Set<String>> tableColumns = new HashMap<>();
        tableColumns.put("sa", SAVINGS_ACCOUNT_COLUMNS);
        tableColumns.put("c", CLIENT_COLUMNS);
        tableColumns.put("g", GROUP_COLUMNS);
        tableColumns.put("s", STAFF_COLUMNS);
        tableColumns.put("sp", SAVINGS_PRODUCT_COLUMNS);
        tableColumns.put("o", OFFICE_COLUMNS);
        tableColumns.put("curr", CURRENCY_COLUMNS);
        tableColumns.put("tg", TAX_GROUP_COLUMNS);
        for (final String appUserAlias : Arrays.asList("sbu", "rbu", "wbu", "abu", "avbu", "cbu")) {
            tableColumns.put(appUserAlias, APP_USER_COLUMNS);
        }
        TABLE_COLUMNS = Collections.unmodifiableMap(tableColumns);

        final Map<String, String> aliases = new HashMap<>();
        for (final String column : SAVINGS_ACCOUNT_COLUMNS) {
            aliases.put(column, "sa." + column);
        }
        aliases.put("accountno", "sa.account_no");
        aliases.put("externalid", "sa.external_id");
        aliases.put("deposittype", "sa.deposit_type_enum");
        aliases.put("status", "sa.status_enum");
        aliases.put("statusenum", "sa.status_enum");
        aliases.put("substatusenum", "sa.sub_status_enum");
        aliases.put("submittedondate", "sa.submittedon_date");
        aliases.put("rejectedondate", "sa.rejectedon_date");
        aliases.put("withdrawnondate", "sa.withdrawnon_date");
        aliases.put("approvedondate", "sa.approvedon_date");
        aliases.put("activatedondate", "sa.activatedon_date");
        aliases.put("closedondate", "sa.closedon_date");
        aliases.put("currencycode", "sa.currency_code");
        aliases.put("nominalannualinterestrate", "sa.nominal_annual_interest_rate");
        aliases.put("accountbalance", "sa.account_balance_derived");
        aliases.put("totaldeposits", "sa.total_deposits_derived");
        aliases.put("totalwithdrawals", "sa.total_withdrawals_derived");
        aliases.put("onholdfunds", "sa.on_hold_funds_derived");
        aliases.put("onholdamount", "sa.total_savings_amount_on_hold");
        aliases.put("allowoverdraft", "sa.allow_overdraft");
        aliases.put("overdraftlimit", "sa.overdraft_limit");
        aliases.put("clientid", "c.id");
        aliases.put("clientname", "c.display_name");
        aliases.put("displayname", "c.display_name");
        aliases.put("groupid", "g.id");
        aliases.put("groupname", "g.display_name");
        aliases.put("productid", "sp.id");
        aliases.put("productname", "sp.name");
        aliases.put("fieldofficerid", "s.id");
        aliases.put("fieldofficername", "s.display_name");
        aliases.put("officeid", "c.office_id");
        aliases.put("officename", "o.name");
        aliases.put("currencyname", "curr.name");
        aliases.put("taxgroupid", "tg.id");
        aliases.put("taxgroupname", "tg.name");
        COLUMN_ALIASES = Collections.unmodifiableMap(aliases);
    }

    static ParsedCriteria parseSearch(final String input) {
        if (input == null || input.trim().isEmpty()) {
            throw new SQLInjectionException();
        }
        final Parser parser = new Parser(tokenize(input));
        return parser.parseSearchExpression();
    }

    static String parseOrderBy(final String input) {
        if (input == null || input.trim().isEmpty()) {
            throw new SQLInjectionException();
        }
        final StringBuilder orderBy = new StringBuilder();
        for (final String sortKey : Splitter.on(',').split(input)) {
            final String key = sortKey.trim();
            if (!key.matches("[a-zA-Z_][a-zA-Z0-9_]*(\\.[a-zA-Z_][a-zA-Z0-9_]*)?")) {
                throw new SQLInjectionException();
            }
            if (orderBy.length() > 0) {
                orderBy.append(", ");
            }
            orderBy.append(resolveColumn(key));
        }
        return orderBy.toString();
    }

    static String parseSortOrder(final String input) {
        if ("asc".equalsIgnoreCase(input.trim())) {
            return "ASC";
        }
        if ("desc".equalsIgnoreCase(input.trim())) {
            return "DESC";
        }
        throw new SQLInjectionException();
    }

    private static String resolveColumn(final String reference) {
        final String normalized = reference.trim().toLowerCase(Locale.ROOT);
        final int dot = normalized.indexOf('.');
        if (dot >= 0) {
            final String table = normalized.substring(0, dot);
            final String column = normalized.substring(dot + 1);
            final Set<String> columns = TABLE_COLUMNS.get(table);
            if (columns != null && columns.contains(column)) {
                return table + "." + column;
            }
            throw new SQLInjectionException();
        }
        final String qualified = COLUMN_ALIASES.get(normalized);
        if (qualified != null) {
            return qualified;
        }
        throw new SQLInjectionException();
    }

    private static List<Token> tokenize(final String input) {
        final List<Token> tokens = new ArrayList<>();
        int i = 0;
        final int length = input.length();
        while (i < length) {
            final char ch = input.charAt(i);
            if (Character.isWhitespace(ch)) {
                i++;
                continue;
            }
            if (ch == '(') {
                tokens.add(new Token(TokenType.LEFT_PAREN, "("));
                i++;
            } else if (ch == ')') {
                tokens.add(new Token(TokenType.RIGHT_PAREN, ")"));
                i++;
            } else if (ch == ',') {
                tokens.add(new Token(TokenType.COMMA, ","));
                i++;
            } else if (ch == '=') {
                tokens.add(new Token(TokenType.OPERATOR, "="));
                i++;
            } else if (ch == '!') {
                if (i + 1 < length && input.charAt(i + 1) == '=') {
                    tokens.add(new Token(TokenType.OPERATOR, "!="));
                    i += 2;
                } else {
                    throw new SQLInjectionException();
                }
            } else if (ch == '>') {
                if (i + 1 < length && input.charAt(i + 1) == '=') {
                    tokens.add(new Token(TokenType.OPERATOR, ">="));
                    i += 2;
                } else {
                    tokens.add(new Token(TokenType.OPERATOR, ">"));
                    i++;
                }
            } else if (ch == '<') {
                if (i + 1 < length && input.charAt(i + 1) == '=') {
                    tokens.add(new Token(TokenType.OPERATOR, "<="));
                    i += 2;
                } else if (i + 1 < length && input.charAt(i + 1) == '>') {
                    tokens.add(new Token(TokenType.OPERATOR, "<>"));
                    i += 2;
                } else {
                    tokens.add(new Token(TokenType.OPERATOR, "<"));
                    i++;
                }
            } else if (ch == '\'' || ch == '"') {
                final char quote = ch;
                final StringBuilder literal = new StringBuilder();
                i++;
                boolean terminated = false;
                while (i < length) {
                    final char current = input.charAt(i);
                    if (current == '\\' && i + 1 < length && input.charAt(i + 1) == quote) {
                        literal.append(current).append(quote);
                        i += 2;
                    } else if (current == quote) {
                        if (i + 1 < length && input.charAt(i + 1) == quote) {
                            literal.append(quote);
                            i += 2;
                        } else {
                            i++;
                            terminated = true;
                            break;
                        }
                    } else {
                        literal.append(current);
                        i++;
                    }
                }
                if (!terminated) {
                    throw new SQLInjectionException();
                }
                tokens.add(new Token(TokenType.STRING, literal.toString()));
            } else if (Character.isDigit(ch) || ((ch == '-' || ch == '+') && i + 1 < length && Character.isDigit(input.charAt(i + 1)))) {
                final int start = i;
                i++;
                while (i < length && (Character.isDigit(input.charAt(i)) || input.charAt(i) == '.')) {
                    i++;
                }
                final String number = input.substring(start, i);
                if (!number.matches("[+-]?[0-9]+(\\.[0-9]+)?")) {
                    throw new SQLInjectionException();
                }
                tokens.add(new Token(TokenType.NUMBER, number));
            } else if (Character.isLetter(ch) || ch == '_') {
                final int start = i;
                while (i < length && (Character.isLetterOrDigit(input.charAt(i)) || input.charAt(i) == '_' || input.charAt(i) == '.')) {
                    i++;
                }
                final String word = input.substring(start, i);
                switch (word.toLowerCase(Locale.ROOT)) {
                    case "and":
                        tokens.add(new Token(TokenType.AND, word));
                    break;
                    case "or":
                        tokens.add(new Token(TokenType.OR, word));
                    break;
                    case "not":
                        tokens.add(new Token(TokenType.NOT, word));
                    break;
                    case "is":
                        tokens.add(new Token(TokenType.IS, word));
                    break;
                    case "null":
                        tokens.add(new Token(TokenType.NULL, word));
                    break;
                    case "like":
                        tokens.add(new Token(TokenType.LIKE, word));
                    break;
                    case "in":
                        tokens.add(new Token(TokenType.IN, word));
                    break;
                    case "true":
                        tokens.add(new Token(TokenType.TRUE, word));
                    break;
                    case "false":
                        tokens.add(new Token(TokenType.FALSE, word));
                    break;
                    default:
                        tokens.add(new Token(TokenType.IDENTIFIER, word));
                }
            } else {
                throw new SQLInjectionException();
            }
        }
        tokens.add(new Token(TokenType.END, ""));
        return tokens;
    }

    /**
     * Recursive-descent parser for {@code or := and ( OR and )*}, {@code and := primary ( AND primary )*},
     * {@code primary := [NOT] ( or | predicate )}.
     */
    private static final class Parser {

        private final List<Token> tokens;
        private int position;

        private Parser(final List<Token> tokens) {
            this.tokens = tokens;
        }

        private Token peek() {
            return tokens.get(position);
        }

        private Token next() {
            return tokens.get(position++);
        }

        private ParsedCriteria parseSearchExpression() {
            final ParsedCriteria criteria = new ParsedCriteria();
            parseOr(criteria);
            if (peek().type != TokenType.END) {
                throw new SQLInjectionException();
            }
            return criteria;
        }

        private void parseOr(final ParsedCriteria criteria) {
            parseAnd(criteria);
            while (peek().type == TokenType.OR) {
                next();
                criteria.sql.append(" or ");
                parseAnd(criteria);
            }
        }

        private void parseAnd(final ParsedCriteria criteria) {
            parsePrimary(criteria);
            while (peek().type == TokenType.AND) {
                next();
                criteria.sql.append(" and ");
                parsePrimary(criteria);
            }
        }

        private void parsePrimary(final ParsedCriteria criteria) {
            if (peek().type == TokenType.NOT) {
                next();
                criteria.sql.append("not (");
                parsePrimary(criteria);
                criteria.sql.append(')');
                return;
            }
            if (peek().type == TokenType.LEFT_PAREN) {
                next();
                criteria.sql.append('(');
                parseOr(criteria);
                if (peek().type != TokenType.RIGHT_PAREN) {
                    throw new SQLInjectionException();
                }
                next();
                criteria.sql.append(')');
                return;
            }
            parsePredicate(criteria);
        }

        private void parsePredicate(final ParsedCriteria criteria) {
            if (peek().type != TokenType.IDENTIFIER) {
                throw new SQLInjectionException();
            }
            final String column = resolveColumn(next().text);
            final TokenType type = peek().type;
            if (type == TokenType.OPERATOR) {
                final String operator = next().text;
                final Token literal = next();
                if (literal.type == TokenType.NULL) {
                    criteria.sql.append(column).append(" is ");
                    if ("!=".equals(operator) || "<>".equals(operator)) {
                        criteria.sql.append("not ");
                    } else if (!"=".equals(operator)) {
                        throw new SQLInjectionException();
                    }
                    criteria.sql.append("null");
                    return;
                }
                criteria.sql.append(column).append(' ').append(operator).append(' ');
                appendLiteral(criteria, literal);
            } else if (type == TokenType.LIKE || type == TokenType.NOT) {
                if (type == TokenType.NOT) {
                    next();
                    if (peek().type == TokenType.LIKE) {
                        next();
                        criteria.sql.append(column).append(" not like ");
                        appendLiteral(criteria, next());
                        return;
                    }
                    if (peek().type == TokenType.IN) {
                        next();
                        criteria.sql.append(column).append(" not in ");
                        appendInList(criteria);
                        return;
                    }
                    throw new SQLInjectionException();
                }
                next();
                criteria.sql.append(column).append(" like ");
                appendLiteral(criteria, next());
            } else if (type == TokenType.IN) {
                next();
                criteria.sql.append(column).append(" in ");
                appendInList(criteria);
            } else if (type == TokenType.IS) {
                next();
                criteria.sql.append(column).append(" is ");
                if (peek().type == TokenType.NOT) {
                    next();
                    criteria.sql.append("not ");
                }
                if (peek().type != TokenType.NULL) {
                    throw new SQLInjectionException();
                }
                next();
                criteria.sql.append("null");
            } else {
                throw new SQLInjectionException();
            }
        }

        private void appendLiteral(final ParsedCriteria criteria, final Token literal) {
            switch (literal.type) {
                case STRING:
                    criteria.sql.append('?');
                    criteria.parameters.add(literal.text);
                break;
                case NUMBER:
                    criteria.sql.append('?');
                    criteria.parameters.add(new BigDecimal(literal.text));
                break;
                case TRUE:
                case FALSE:
                    criteria.sql.append(literal.text.toLowerCase(Locale.ROOT));
                break;
                default:
                    throw new SQLInjectionException();
            }
        }

        private void appendInList(final ParsedCriteria criteria) {
            if (next().type != TokenType.LEFT_PAREN) {
                throw new SQLInjectionException();
            }
            criteria.sql.append('(');
            if (peek().type == TokenType.RIGHT_PAREN) {
                throw new SQLInjectionException();
            }
            while (true) {
                criteria.sql.append('?');
                criteria.parameters.add(literalValue(next()));
                final Token separator = next();
                if (separator.type == TokenType.RIGHT_PAREN) {
                    break;
                }
                if (separator.type != TokenType.COMMA) {
                    throw new SQLInjectionException();
                }
                criteria.sql.append(", ");
            }
            criteria.sql.append(')');
        }

        private Object literalValue(final Token literal) {
            switch (literal.type) {
                case STRING:
                    return literal.text;
                case NUMBER:
                    return new BigDecimal(literal.text);
                case TRUE:
                    return 1;
                case FALSE:
                    return 0;
                default:
                    throw new SQLInjectionException();
            }
        }
    }
}
