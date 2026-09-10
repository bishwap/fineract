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
package org.apache.fineract.mix.domain;

import com.google.gson.Gson;
import com.google.gson.JsonSyntaxException;
import com.google.gson.reflect.TypeToken;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.Table;
import org.apache.commons.lang3.StringUtils;
import org.apache.fineract.infrastructure.core.api.JsonCommand;
import org.apache.fineract.infrastructure.core.data.ApiParameterError;
import org.apache.fineract.infrastructure.core.domain.AbstractPersistableCustom;
import org.apache.fineract.infrastructure.core.exception.PlatformApiDataValidationException;
import org.apache.fineract.mix.service.XBRLMappingExpressionEvaluator;

@Entity
@Table(name = "mix_taxonomy_mapping")
public class MixTaxonomyMapping extends AbstractPersistableCustom {

    @Column(name = "identifier")
    private String identifier;

    @Column(name = "config")
    private String config;

    @Column(name = "currency")
    private String currency;

    protected MixTaxonomyMapping() {
        // default
    }

    private MixTaxonomyMapping(final String identifier, final String config, final String currency) {
        this.identifier = StringUtils.defaultIfEmpty(identifier, null);
        this.config = StringUtils.defaultIfEmpty(config, null);
        this.currency = StringUtils.defaultIfEmpty(currency, null);
    }

    public static MixTaxonomyMapping fromJson(final JsonCommand command) {
        final String identifier = command.stringValueOfParameterNamed("identifier");
        final String config = command.stringValueOfParameterNamed("config");
        final String currency = command.stringValueOfParameterNamed("currency");
        validateConfig(config);
        return new MixTaxonomyMapping(identifier, config, currency);
    }

    public void update(final JsonCommand command) {
        final String newConfig = command.stringValueOfParameterNamed("config");
        validateConfig(newConfig);

        this.identifier = command.stringValueOfParameterNamed("identifier");
        this.config = newConfig;
        this.currency = command.stringValueOfParameterNamed("currency");

    }

    /**
     * The config is a JSON object of taxonomyId -> arithmetic expression over {glcode} placeholders. Each expression is
     * parsed by the restricted evaluator so that nothing but numbers, +, -, *, /, parentheses and placeholders can be
     * persisted.
     */
    static void validateConfig(final String config) {
        if (StringUtils.isEmpty(config)) {
            return;
        }
        final List<ApiParameterError> errors = new ArrayList<>();
        Map<String, String> configMap = null;
        try {
            configMap = new Gson().fromJson(config, new TypeToken<Map<String, String>>() {}.getType());
        } catch (final JsonSyntaxException e) {
            errors.add(ApiParameterError.parameterError("validation.msg.xbrl.mapping.config.invalid.json",
                    "The config parameter must be a JSON object mapping taxonomy ids to expressions", "config"));
        }
        if (configMap != null) {
            for (final Map.Entry<String, String> entry : configMap.entrySet()) {
                try {
                    Long.parseLong(entry.getKey());
                } catch (final NumberFormatException e) {
                    errors.add(ApiParameterError.parameterErrorWithValue("validation.msg.xbrl.mapping.config.invalid.taxonomy.id",
                            "Taxonomy id `" + entry.getKey() + "` must be numeric", "config", entry.getKey()));
                }
                try {
                    XBRLMappingExpressionEvaluator.validate(entry.getValue());
                } catch (final IllegalArgumentException | ArithmeticException e) {
                    errors.add(ApiParameterError.parameterErrorWithValue("validation.msg.xbrl.mapping.config.invalid.expression",
                            "Mapping for taxonomy `" + entry.getKey() + "` is not a valid arithmetic expression: " + e.getMessage(),
                            "config", entry.getValue()));
                }
            }
        }
        if (!errors.isEmpty()) {
            throw new PlatformApiDataValidationException(errors);
        }
    }

}
