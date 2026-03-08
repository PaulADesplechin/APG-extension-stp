// Mock data generator for demo mode (no BSP Link access needed)
const MockDataGenerator = {
  // Simulates BSP Link Ticketing Authority lookup
  generateResult(iataCode, country) {
    const rand = Math.random();
    // 75% Active, 25% Inactive
    const isActive = rand > 0.25;
    // If Active: 85% Enabled, 15% Disabled
    // If Inactive: 10% Enabled, 90% Disabled
    const isEnabled = isActive ? Math.random() > 0.15 : Math.random() > 0.9;
    // 5% chance not found
    const notFound = Math.random() < 0.05;

    if (notFound) {
      return {
        iataCode,
        country,
        agentStatus: 'Not Found',
        ticketingAuthority: 'N/A',
        agentName: '',
        lookupStatus: 'not_found'
      };
    }

    return {
      iataCode,
      country,
      agentStatus: isActive ? 'Active' : 'Inactive',
      ticketingAuthority: isEnabled ? 'Enabled' : 'Disabled',
      agentName: this.randomAgentName(),
      lookupStatus: 'found'
    };
  },

  // Generate results for a batch of codes with simulated delay
  async generateBatchResults(rows, iataColumn, countryColumn, onProgress) {
    const results = [];
    const total = rows.length;

    // Group by country for realistic simulation
    const groups = {};
    for (const row of rows) {
      const country = row[countryColumn] || 'XX';
      if (!groups[country]) groups[country] = [];
      groups[country].push(row);
    }

    let completed = 0;
    for (const [country, countryRows] of Object.entries(groups)) {
      if (onProgress) {
        onProgress({
          type: 'country_switch',
          country,
          countryName: getCountryName(country),
          completed,
          total
        });
      }
      // Simulate country switch delay
      await this.delay(300 + Math.random() * 500);

      for (const row of countryRows) {
        const iataCode = String(row[iataColumn] || '').trim();
        if (!iataCode) {
          completed++;
          continue;
        }

        // Simulate lookup delay
        await this.delay(50 + Math.random() * 150);

        const result = this.generateResult(iataCode, country);
        results.push({ ...result, rowIndex: rows.indexOf(row) });
        completed++;

        if (onProgress) {
          onProgress({
            type: 'row_result',
            ...result,
            completed,
            total,
            percent: Math.round((completed / total) * 100)
          });
        }
      }
    }

    return results;
  },

  randomAgentName() {
    const prefixes = ['GLOBAL', 'WORLD', 'EXPRESS', 'PREMIUM', 'ROYAL', 'STAR', 'GOLDEN', 'ATLANTIC', 'PACIFIC', 'CONTINENTAL'];
    const suffixes = ['TRAVEL', 'TOURS', 'VOYAGES', 'TOURISM LLC', 'TRAVEL AGENCY', 'HOLIDAYS', 'SERVICES', 'FLIGHTS'];
    return `${prefixes[Math.floor(Math.random() * prefixes.length)]} ${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
  },

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};
