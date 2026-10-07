# Bay Area towns and state codes count as the US for the counsel gate · 7 Oct 2026

W5 writers on the night of 7 Oct saw "outside the US, no counsel gate" on LPs placed in Palo Alto and other Bay Area
towns: the US matcher knew states and eight cities, so a finding that gave only the town read as abroad. `IN_US` now
knows the Bay Area and Peninsula towns, the larger US cities and the usual LP places (Greenwich, Palm Beach, Aspen,
Jackson Hole), and a place ending in a state's postal code after a comma ("Woodside, CA") is the US. The codes are
upper case only and leave out the ones another country's places are written with, so "Toronto, ON" is still abroad.
