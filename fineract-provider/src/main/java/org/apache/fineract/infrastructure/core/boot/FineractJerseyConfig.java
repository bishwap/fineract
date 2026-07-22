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

import org.apache.fineract.infrastructure.core.filters.ResponseCorsFilter;
import org.glassfish.jersey.media.multipart.MultiPartFeature;
import org.glassfish.jersey.server.ResourceConfig;
import org.glassfish.jersey.server.ServerProperties;

/**
 * Jersey 3.1 {@link ResourceConfig} that replaces the former Sun-Jersey {@code SpringServlet} wiring. Resource and
 * provider classes (annotated with {@code @Path} / {@code @Provider}) are discovered by package scanning; because
 * {@code jersey-spring6} is on the classpath its {@code SpringComponentProvider} bridges those classes to their Spring
 * beans so dependency injection continues to work.
 */
public class FineractJerseyConfig extends ResourceConfig {

    public FineractJerseyConfig() {
        packages("org.apache.fineract");
        register(MultiPartFeature.class);
        register(ResponseCorsFilter.class);
        // POJO/JSON mapping in Jersey 3 is provided by jersey-media-json-jackson (auto-registered).
        property(ServerProperties.WADL_FEATURE_DISABLE, true);
    }
}
