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
package org.apache.fineract.infrastructure.core.data;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.apache.fineract.infrastructure.security.utils.SQLInjectionException;
import org.junit.jupiter.api.Test;

public class PaginationParametersTest {

    @Test
    public void noOrderByRequested() {
        assertEquals("", PaginationParameters.instance(false, null, null, null, null).orderBySql());
    }

    @Test
    public void columnNamesAreAccepted() {
        assertEquals(" order by id", PaginationParameters.instance(false, null, null, "id", null).orderBySql());
        assertEquals(" order by g.display_name DESC",
                PaginationParameters.instance(false, null, null, "g.display_name", "DESC").orderBySql());
        assertEquals(" order by id, o.name asc", PaginationParameters.instance(false, null, null, "id, o.name", "asc").orderBySql());
    }

    @Test
    public void orderByInjectionIsRejected() {
        final PaginationParameters parameters = PaginationParameters.instance(false, null, null,
                "(select case when (select count(*) from m_appuser) > 0 then sleep(5) else 1 end)", null);
        assertThrows(SQLInjectionException.class, parameters::orderBySql);
        assertThrows(SQLInjectionException.class, parameters::paginationSql);
    }

    @Test
    public void sortOrderInjectionIsRejected() {
        final PaginationParameters parameters = PaginationParameters.instance(false, null, null, "id",
                "asc, (select 1 from m_appuser where password like 'a%')");
        assertThrows(SQLInjectionException.class, parameters::orderBySql);
        assertThrows(SQLInjectionException.class, parameters::paginationSql);
    }
}
