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
package org.apache.fineract.template;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.common.io.Resources;
import com.google.common.reflect.TypeToken;
import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Type;
import java.math.RoundingMode;
import java.net.MalformedURLException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.apache.fineract.organisation.monetary.domain.MonetaryCurrency;
import org.apache.fineract.organisation.monetary.domain.MoneyHelper;
import org.apache.fineract.portfolio.loanaccount.LoanScheduleTestDataHelper;
import org.apache.fineract.portfolio.loanaccount.MonetaryCurrencyBuilder;
import org.apache.fineract.portfolio.loanaccount.domain.LoanRepaymentScheduleInstallment;
import org.apache.fineract.template.domain.Template;
import org.apache.fineract.template.domain.TemplateMapper;
import org.apache.fineract.template.service.TemplateMergeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

public class TemplateMergeServiceTest {

    private TemplateMergeService tms = new TemplateMergeService();

    @BeforeEach
    public void setUpForEachTestCase() throws Exception {

        Field field = MoneyHelper.class.getDeclaredField("roundingMode");
        field.setAccessible(true);
        field.set(null, RoundingMode.HALF_EVEN);
    }

    @Test
    public void compileHelloTemplate() throws Exception {
        String templateText = "Hello Test for Template {{file.name}}!";

        File file = new File("hello");
        Map<String, Object> scopes = new HashMap<>();
        scopes.put("file", file);

        String output = compileTemplateText(templateText, scopes);
        assertEquals("Hello Test for Template hello!", output);
    }

    @Test
    public void compileLoanSummary() throws IOException {
        LocalDate july2nd = LocalDate.of(2012, 7, 2);
        MonetaryCurrency usDollars = new MonetaryCurrencyBuilder().withCode("USD").withDigitsAfterDecimal(2).build();
        List<LoanRepaymentScheduleInstallment> installments = LoanScheduleTestDataHelper.createSimpleLoanSchedule(july2nd, usDollars);

        Map<String, Object> scopes = new HashMap<>();
        scopes.put("installments", installments);

        String templateText = Resources.toString(Resources.getResource("template.mustache"), StandardCharsets.UTF_8);
        String expectedOutput = Resources.toString(Resources.getResource("template-expected.html"), StandardCharsets.UTF_8);

        String output = compileTemplateText(templateText, scopes);
        assertEquals(expectedOutput, output);
    }

    @Test
    public void arrayUsingLoop() throws Exception {
        String templateText = "Hello Test for Template{{#data.name}} {{.}}{{/data.name}}!";
        String jsonData = "{\"name\": [ \"Michael\", \"Terence\" ] }";
        String expectedOutput = "Hello Test for Template Michael Terence!";

        Map<String, Object> scopes = new HashMap<>();
        scopes.put("data", createMapFromJSON(jsonData));

        String output = compileTemplateText(templateText, scopes);
        assertEquals(expectedOutput, output);
    }

    @Test
    public void arrayUsingIndex() throws Exception {
        String templateText = "Hello Test for Template {{data.name#1}} & {{data.name#0}}!";
        String jsonData = "{\"name\": [ \"Michael\", \"Terence\" ] }";
        String expectedOutput = "Hello Test for Template Terence & Michael!";

        Map<String, Object> scopes = new HashMap<>();
        scopes.put("data", createMapFromJSON(jsonData));

        String output = compileTemplateText(templateText, scopes);
        assertEquals(expectedOutput, output);
    }

    @Test
    public void ssrfGuardRejectsForbiddenMapperUrls() throws Exception {
        // Cloud metadata endpoint, loopback, private ranges and non-http schemes must be rejected.
        assertUrlRejected("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
        assertUrlRejected("http://127.0.0.1/internal");
        assertUrlRejected("http://localhost:8080/admin");
        assertUrlRejected("http://10.0.0.1/");
        assertUrlRejected("http://192.168.1.1/");
        assertUrlRejected("http://172.16.0.1/");
        assertUrlRejected("http://[::1]/");
        assertUrlRejected("file:///etc/passwd");
        assertUrlRejected("ftp://example.com/");
        assertUrlRejected("not a url");
    }

    @Test
    public void ssrfGuardAllowsPublicMapperUrls() throws Exception {
        // Literal public IPs resolve without a DNS lookup, so this stays offline and deterministic.
        invokeValidateUrl("http://8.8.8.8/");
        invokeValidateUrl("https://1.1.1.1/some/path");
    }

    @Test
    public void ssrfGuardPinsConnectUrlToResolvedIp() throws Exception {
        // The returned connect URL must target the resolved IP (defeats DNS rebinding) while preserving the
        // original host as the Host header, and keeping scheme/port/path/query intact.
        Object safeUrl = invokeValidateUrl("http://8.8.8.8:81/some/path?q=1");
        assertEquals("http://8.8.8.8:81/some/path?q=1", readField(safeUrl, "connectUrl"));
        assertEquals("8.8.8.8:81", readField(safeUrl, "hostHeader"));
    }

    @Test
    public void ssrfGuardAllowsSelfReferentialBaseUri() throws Exception {
        // A mapper URL pointing back at the application's own base URI must be allowed even though it resolves to
        // loopback/private, otherwise legitimate self-referential fetches break on localhost/internal deployments.
        Field scopesField = TemplateMergeService.class.getDeclaredField("scopes");
        scopesField.setAccessible(true);
        Map<String, Object> scopes = new HashMap<>();
        scopes.put("BASE_URI", "https://localhost:8443/fineract-provider/api/v1/");
        scopesField.set(tms, scopes);

        invokeValidateUrl("https://localhost:8443/fineract-provider/api/v1/runreports/x");
        // A different loopback origin (not the base URI) must still be rejected.
        assertUrlRejected("https://localhost:9999/other");
    }

    private void assertUrlRejected(String url) {
        InvocationTargetException wrapper = assertThrows(InvocationTargetException.class, () -> invokeValidateUrl(url));
        assertTrue(wrapper.getCause() instanceof IOException, "Expected IOException for URL: " + url);
    }

    private Object invokeValidateUrl(String url) throws Exception {
        Method method = TemplateMergeService.class.getDeclaredMethod("validateAndPinUrl", String.class);
        method.setAccessible(true);
        return method.invoke(tms, url);
    }

    private String readField(Object obj, String fieldName) throws Exception {
        Field f = obj.getClass().getDeclaredField(fieldName);
        f.setAccessible(true);
        return (String) f.get(obj);
    }

    protected String compileTemplateText(String templateText, Map<String, Object> scope) throws MalformedURLException, IOException {
        List<TemplateMapper> mappers = new ArrayList<>();
        Template template = new Template("TemplateName", templateText, null, null, mappers);
        return tms.compile(template, scope);
    }

    protected Map<String, Object> createMapFromJSON(String jsonText) {
        Gson gson = new Gson();
        Type ssMap = new TypeToken<Map<String, Object>>() {}.getType();
        JsonElement json = JsonParser.parseString(jsonText);
        return gson.fromJson(json, ssMap);
    }
}
