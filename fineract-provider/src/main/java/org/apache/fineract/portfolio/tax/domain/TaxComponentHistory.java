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
package org.apache.fineract.portfolio.tax.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Temporal;
import jakarta.persistence.TemporalType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Date;
import org.apache.fineract.infrastructure.core.domain.AbstractAuditableCustom;
import org.apache.fineract.infrastructure.core.service.DateUtils;

@Entity
@Table(name = "m_tax_component_history")
public class TaxComponentHistory extends AbstractAuditableCustom {

    @Column(name = "percentage", scale = 6, precision = 19, nullable = false)
    private BigDecimal percentage;

    @Column(name = "start_date", nullable = false)
    @Temporal(TemporalType.DATE)
    private Date startDate;

    @Column(name = "end_date", nullable = false)
    @Temporal(TemporalType.DATE)
    private Date endDate;

    protected TaxComponentHistory() {

    }

    private TaxComponentHistory(final BigDecimal percentage, final LocalDate startDate, final LocalDate endDate) {
        this.percentage = percentage;
        this.startDate = Date.from(startDate.atStartOfDay(DateUtils.getDateTimeZoneOfTenant()).toInstant());
        this.endDate = Date.from(endDate.atStartOfDay(DateUtils.getDateTimeZoneOfTenant()).toInstant());
    }

    public static TaxComponentHistory createTaxComponentHistory(final BigDecimal percentage, final LocalDate startDate,
            final LocalDate endDate) {
        return new TaxComponentHistory(percentage, startDate, endDate);
    }

    public LocalDate startDate() {
        LocalDate startDate = null;
        if (this.startDate != null) {
            startDate = LocalDate.ofInstant(this.startDate.toInstant(), DateUtils.getDateTimeZoneOfTenant());
        }
        return startDate;
    }

    public LocalDate endDate() {
        LocalDate endDate = null;
        if (this.endDate != null) {
            endDate = LocalDate.ofInstant(this.endDate.toInstant(), DateUtils.getDateTimeZoneOfTenant());
        }
        return endDate;
    }

    public boolean occursOnDayFromAndUpToAndIncluding(final LocalDate target) {
        if (this.endDate == null) {
            return target != null && target.isAfter(startDate());
        }
        return target != null && target.isAfter(startDate()) && !target.isAfter(endDate());
    }

    public BigDecimal getPercentage() {
        return this.percentage;
    }

}
