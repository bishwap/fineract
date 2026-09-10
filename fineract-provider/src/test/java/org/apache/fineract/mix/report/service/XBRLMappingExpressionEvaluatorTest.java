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
package org.apache.fineract.mix.report.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.util.Map;
import org.apache.fineract.mix.service.XBRLMappingExpressionEvaluator;
import org.junit.jupiter.api.Test;

public class XBRLMappingExpressionEvaluatorTest {

    private static final Map<String, BigDecimal> BALANCES = Map.of("12300", new BigDecimal("100.50"), "11100", new BigDecimal("-20"));

    @Test
    public void shouldEvaluateArithmeticWithPlaceholders() {
        assertEquals(0, new BigDecimal("80.50").compareTo(XBRLMappingExpressionEvaluator.evaluate("{12300} + {11100}", BALANCES)));
        assertEquals(0, new BigDecimal("241").compareTo(XBRLMappingExpressionEvaluator.evaluate("({12300} - {11100}) * 2", BALANCES)));
        assertEquals(0, new BigDecimal("-2.5").compareTo(XBRLMappingExpressionEvaluator.evaluate("-5 / 2", BALANCES)));
        assertEquals(0, BigDecimal.ZERO.compareTo(XBRLMappingExpressionEvaluator.evaluate("{unknown}", BALANCES)));
    }

    @Test
    public void shouldRejectScriptInjection() {
        assertThrows(IllegalArgumentException.class,
                () -> XBRLMappingExpressionEvaluator.validate("java.lang.Runtime.getRuntime().exec('id')"));
        assertThrows(IllegalArgumentException.class, () -> XBRLMappingExpressionEvaluator.validate("{12300}; print(1)"));
        assertThrows(IllegalArgumentException.class, () -> XBRLMappingExpressionEvaluator.validate("{12300} + x"));
        assertThrows(IllegalArgumentException.class, () -> XBRLMappingExpressionEvaluator.validate("(1 + 2"));
        assertThrows(IllegalArgumentException.class, () -> XBRLMappingExpressionEvaluator.validate(""));
    }

    @Test
    public void shouldOnlyEnforceDivisionByZeroAtEvaluationTime() {
        XBRLMappingExpressionEvaluator.validate("{12300} / {99999}");
        assertEquals(0, new BigDecimal("-5.025").compareTo(XBRLMappingExpressionEvaluator.evaluate("{12300} / {11100}", BALANCES)));
        assertThrows(IllegalArgumentException.class, () -> XBRLMappingExpressionEvaluator.evaluate("{12300} / {99999}", BALANCES));
        assertThrows(IllegalArgumentException.class, () -> XBRLMappingExpressionEvaluator.evaluate("1 / 0", BALANCES));
    }
}
