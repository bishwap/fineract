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
package org.apache.fineract.infrastructure.core.boot;

import static org.springframework.security.web.util.matcher.AntPathRequestMatcher.antMatcher;

import jakarta.servlet.Filter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.expression.WebExpressionAuthorizationManager;
import org.springframework.security.web.authentication.www.BasicAuthenticationEntryPoint;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.security.web.context.SecurityContextHolderFilter;

/**
 * Spring Security 6 replacement for the {@code basicauth} portion of the former {@code securityContext.xml}.
 *
 * <p>
 * The legacy XML {@code <http use-expressions="true">} DSL, the {@code access-decision-manager}/voter model and the
 * {@code spring-security-oauth2} authorization-server were all removed in Spring Security 6. Only the default
 * {@code basicauth} profile is rebuilt here as a {@link SecurityFilterChain}. The {@code oauth} profile is a documented
 * blocker (see UPGRADE-JAVA21-NOTES.md Phase 6) pending a rebuild on Spring Authorization Server / Boot
 * resource-server.
 *
 * <p>
 * NOTE: this configuration is a best-effort, review-required translation of the XML rules; it has not been runtime
 * verified as part of the migration.
 */
@Configuration
@Profile("basicauth")
public class SecurityConfiguration {

    private static final String TWO_FACTOR_ACCESS = "isFullyAuthenticated() and hasAuthority('TWOFACTOR_AUTHENTICATED')";

    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    public AuthenticationEntryPoint basicAuthenticationEntryPoint() {
        final BasicAuthenticationEntryPoint entryPoint = new BasicAuthenticationEntryPoint();
        entryPoint.setRealmName("Fineract Platform API");
        return entryPoint;
    }

    @Bean
    public DaoAuthenticationProvider customAuthenticationProvider(
            @Qualifier("userDetailsService") final UserDetailsService userDetailsService, final PasswordEncoder passwordEncoder) {
        final DaoAuthenticationProvider provider = new DaoAuthenticationProvider();
        provider.setUserDetailsService(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        return provider;
    }

    @Bean
    public AuthenticationManager authenticationManager(final DaoAuthenticationProvider customAuthenticationProvider) {
        final ProviderManager providerManager = new ProviderManager(customAuthenticationProvider);
        // FINERACT relies on the credentials still being present after authentication (see two-factor handling).
        providerManager.setEraseCredentialsAfterAuthentication(false);
        return providerManager;
    }

    @Bean
    public SecurityFilterChain apiSecurityFilterChain(final HttpSecurity http,
            @Qualifier("basicAuthenticationProcessingFilter") final Filter basicAuthenticationProcessingFilter,
            @Qualifier("twoFactorAuthFilter") final Filter twoFactorAuthFilter,
            final AuthenticationEntryPoint basicAuthenticationEntryPoint) throws Exception {

        http.securityMatcher(antMatcher("/api/**"))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).csrf(csrf -> csrf.disable())
                .requiresChannel(channel -> channel.anyRequest().requiresSecure())
                .exceptionHandling(handling -> handling.authenticationEntryPoint(basicAuthenticationEntryPoint))
                .authorizeHttpRequests(auth -> auth.requestMatchers(antMatcher("/api/*/echo")).permitAll()
                        .requestMatchers(antMatcher(HttpMethod.POST, "/api/*/authentication")).permitAll()
                        .requestMatchers(antMatcher(HttpMethod.POST, "/api/*/self/authentication")).permitAll()
                        .requestMatchers(antMatcher(HttpMethod.POST, "/api/*/self/registration")).permitAll()
                        .requestMatchers(antMatcher(HttpMethod.POST, "/api/*/self/registration/user")).permitAll()
                        .requestMatchers(antMatcher(HttpMethod.GET, "/api/*/twofactor")).fullyAuthenticated()
                        .requestMatchers(antMatcher(HttpMethod.POST, "/api/*/twofactor")).fullyAuthenticated()
                        .requestMatchers(antMatcher(HttpMethod.POST, "/api/*/twofactor/validate")).fullyAuthenticated().anyRequest()
                        .access(new WebExpressionAuthorizationManager(TWO_FACTOR_ACCESS)))
                .addFilterAfter(basicAuthenticationProcessingFilter, SecurityContextHolderFilter.class)
                .addFilterAfter(twoFactorAuthFilter, BasicAuthenticationFilter.class);

        return http.build();
    }
}
