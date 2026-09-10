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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.util.Arrays;
import org.apache.fineract.infrastructure.security.utils.SQLInjectionException;
import org.apache.fineract.portfolio.savings.service.SavingsAccountQueryParser.ParsedCriteria;
import org.junit.jupiter.api.Test;

public class SavingsAccountQueryParserTest {

    @Test
    public void testSimpleEqualityPredicate() {
        final ParsedCriteria criteria = SavingsAccountQueryParser.parseSearch("accountNo = '000000000001'");
        assertEquals("sa.account_no = ?", criteria.sql());
        assertEquals(Arrays.asList("000000000001"), criteria.parameters());
    }

    @Test
    public void testNumericAndQualifiedColumn() {
        final ParsedCriteria criteria = SavingsAccountQueryParser.parseSearch("sa.id=12345");
        assertEquals("sa.id = ?", criteria.sql());
        assertEquals(Arrays.asList(new BigDecimal("12345")), criteria.parameters());
    }

    @Test
    public void testCompoundPredicateWithAndOr() {
        final ParsedCriteria criteria = SavingsAccountQueryParser
                .parseSearch("clientName like 'smith%' and (statusEnum = 300 or statusEnum = 400)");
        assertEquals("c.display_name like ? and (sa.status_enum = ? or sa.status_enum = ?)", criteria.sql());
        assertEquals(Arrays.asList("smith%", new BigDecimal("300"), new BigDecimal("400")), criteria.parameters());
    }

    @Test
    public void testNotInAndIsNull() {
        final ParsedCriteria criteria = SavingsAccountQueryParser
                .parseSearch("sa.status_enum not in (100, 200) and externalId is not null");
        assertEquals("sa.status_enum not in (?, ?) and sa.external_id is not null", criteria.sql());
        assertEquals(Arrays.asList(new BigDecimal("100"), new BigDecimal("200")), criteria.parameters());
    }

    @Test
    public void testRejectsFunctionCallInjection() {
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseSearch("sa.id = benchmark(50000000,sha1(rand()))"));
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseSearch("extractvalue(1,concat(0x7e,version()))"));
    }

    @Test
    public void testRejectsTautologyAndCommentInjection() {
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseSearch("1=1"));
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseSearch("sa.id = 1 or sa.id > 0 --"));
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseSearch("sa.account_no = 'x' union select 1"));
    }

    @Test
    public void testOrderByAllowlist() {
        assertEquals("sa.account_no", SavingsAccountQueryParser.parseOrderBy("accountNo"));
        assertEquals("sa.id, c.display_name", SavingsAccountQueryParser.parseOrderBy("sa.id, clientName"));
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseOrderBy("sa.id desc"));
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseOrderBy("(select sleep(10))"));
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseOrderBy("unknown_column"));
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseOrderBy("sa.password"));
    }

    @Test
    public void testSortOrder() {
        assertEquals("ASC", SavingsAccountQueryParser.parseSortOrder("asc"));
        assertEquals("DESC", SavingsAccountQueryParser.parseSortOrder(" DESC "));
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseSortOrder(",benchmark(50000000,sha1(rand()))"));
        assertThrows(SQLInjectionException.class, () -> SavingsAccountQueryParser.parseSortOrder("descending"));
    }
}
