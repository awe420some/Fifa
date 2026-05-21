// Group + knockout matches for the 1994–2022 World Cups.
// Sourced from each tournament's per-group / knockout-stage Wikipedia
// articles (fetched 2026-05-20). 372 matches across 7 tournaments.
// 2014 KO is held in data.js's HISTORICAL_KNOCKOUTS — combined at use site.

const m = (year, stage, group, A, B, sA, sB, et = false, penA = null, penB = null, hostFor = null) => ({
  year, stage, group, teamA: A, teamB: B, scoreA: sA, scoreB: sB, et, penA, penB, hostBonusFor: hostFor,
});

export const NEW_HISTORICAL_MATCHES = {
1994: [
m(1994,"group","A","USA","SUI",1,1,false,null,null,"USA"),m(1994,"group","A","COL","ROU",1,3),m(1994,"group","A","ROU","SUI",1,4),m(1994,"group","A","USA","COL",2,1,false,null,null,"USA"),m(1994,"group","A","SUI","COL",0,2),m(1994,"group","A","USA","ROU",0,1,false,null,null,"USA"),
m(1994,"group","B","CMR","SWE",2,2),m(1994,"group","B","BRA","RUS",2,0),m(1994,"group","B","BRA","CMR",3,0),m(1994,"group","B","SWE","RUS",3,1),m(1994,"group","B","RUS","CMR",6,1),m(1994,"group","B","BRA","SWE",1,1),
m(1994,"group","C","GER","BOL",1,0),m(1994,"group","C","ESP","KOR",2,2),m(1994,"group","C","GER","ESP",1,1),m(1994,"group","C","KOR","BOL",0,0),m(1994,"group","C","BOL","ESP",1,3),m(1994,"group","C","GER","KOR",3,2),
m(1994,"group","D","ARG","GRE",4,0),m(1994,"group","D","NGA","BUL",3,0),m(1994,"group","D","ARG","NGA",2,1),m(1994,"group","D","BUL","GRE",4,0),m(1994,"group","D","ARG","BUL",0,2),m(1994,"group","D","GRE","NGA",0,2),
m(1994,"group","E","ITA","IRL",0,1),m(1994,"group","E","NOR","MEX",1,0),m(1994,"group","E","ITA","NOR",1,0),m(1994,"group","E","MEX","IRL",2,1),m(1994,"group","E","ITA","MEX",1,1),m(1994,"group","E","IRL","NOR",0,0),
m(1994,"group","F","BEL","MAR",1,0),m(1994,"group","F","NED","KSA",2,1),m(1994,"group","F","BEL","NED",1,0),m(1994,"group","F","KSA","MAR",2,1),m(1994,"group","F","BEL","KSA",0,1),m(1994,"group","F","MAR","NED",1,2),
m(1994,"R16",null,"GER","BEL",3,2),m(1994,"R16",null,"ESP","SUI",3,0),m(1994,"R16",null,"SWE","KSA",3,1),m(1994,"R16",null,"ROU","ARG",3,2),m(1994,"R16",null,"NED","IRL",2,0),m(1994,"R16",null,"BRA","USA",1,0,false,null,null,"USA"),m(1994,"R16",null,"ITA","NGA",2,1,true),m(1994,"R16",null,"MEX","BUL",1,1,true,1,3),
m(1994,"QF",null,"ITA","ESP",2,1),m(1994,"QF",null,"NED","BRA",2,3),m(1994,"QF",null,"BUL","GER",2,1),m(1994,"QF",null,"ROU","SWE",2,2,true,4,5),
m(1994,"SF",null,"BUL","ITA",1,2),m(1994,"SF",null,"SWE","BRA",0,1),
m(1994,"third",null,"SWE","BUL",4,0),m(1994,"final",null,"BRA","ITA",0,0,true,3,2),
],
1998: [
m(1998,"group","A","BRA","SCO",2,1),m(1998,"group","A","MAR","NOR",2,2),m(1998,"group","A","SCO","NOR",1,1),m(1998,"group","A","BRA","MAR",3,0),m(1998,"group","A","BRA","NOR",1,2),m(1998,"group","A","SCO","MAR",0,3),
m(1998,"group","B","ITA","CHI",2,2),m(1998,"group","B","CMR","AUT",1,1),m(1998,"group","B","CHI","AUT",1,1),m(1998,"group","B","ITA","CMR",3,0),m(1998,"group","B","ITA","AUT",2,1),m(1998,"group","B","CHI","CMR",1,1),
m(1998,"group","C","FRA","RSA",3,0,false,null,null,"FRA"),m(1998,"group","C","KSA","DEN",0,1),m(1998,"group","C","FRA","KSA",4,0,false,null,null,"FRA"),m(1998,"group","C","RSA","DEN",1,1),m(1998,"group","C","FRA","DEN",2,1,false,null,null,"FRA"),m(1998,"group","C","RSA","KSA",2,2),
m(1998,"group","D","PAR","BUL",0,0),m(1998,"group","D","ESP","NGA",2,3),m(1998,"group","D","NGA","BUL",1,0),m(1998,"group","D","ESP","PAR",0,0),m(1998,"group","D","ESP","BUL",6,1),m(1998,"group","D","NGA","PAR",1,3),
m(1998,"group","E","KOR","MEX",1,3),m(1998,"group","E","NED","BEL",0,0),m(1998,"group","E","BEL","MEX",2,2),m(1998,"group","E","NED","KOR",5,0),m(1998,"group","E","BEL","KOR",1,1),m(1998,"group","E","NED","MEX",2,2),
m(1998,"group","F","YUG","IRN",1,0),m(1998,"group","F","GER","USA",2,0),m(1998,"group","F","GER","YUG",2,2),m(1998,"group","F","USA","IRN",1,2),m(1998,"group","F","GER","IRN",2,0),m(1998,"group","F","USA","YUG",0,1),
m(1998,"group","G","ENG","TUN",2,0),m(1998,"group","G","ROU","COL",1,0),m(1998,"group","G","COL","TUN",1,0),m(1998,"group","G","ROU","ENG",2,1),m(1998,"group","G","ROU","TUN",1,1),m(1998,"group","G","COL","ENG",0,2),
m(1998,"group","H","ARG","JPN",1,0),m(1998,"group","H","JAM","CRO",1,3),m(1998,"group","H","JPN","CRO",0,1),m(1998,"group","H","ARG","JAM",5,0),m(1998,"group","H","ARG","CRO",1,0),m(1998,"group","H","JPN","JAM",1,2),
m(1998,"R16",null,"ITA","NOR",1,0),m(1998,"R16",null,"BRA","CHI",4,1),m(1998,"R16",null,"FRA","PAR",1,0,true,null,null,"FRA"),m(1998,"R16",null,"NGA","DEN",1,4),m(1998,"R16",null,"GER","MEX",2,1),m(1998,"R16",null,"NED","YUG",2,1),m(1998,"R16",null,"ROU","CRO",0,1),m(1998,"R16",null,"ARG","ENG",2,2,true,4,3),
m(1998,"QF",null,"ITA","FRA",0,0,true,3,4,"FRA"),m(1998,"QF",null,"BRA","DEN",3,2),m(1998,"QF",null,"NED","ARG",2,1),m(1998,"QF",null,"GER","CRO",0,3),
m(1998,"SF",null,"BRA","NED",1,1,true,4,2),m(1998,"SF",null,"FRA","CRO",2,1,false,null,null,"FRA"),
m(1998,"third",null,"NED","CRO",1,2),m(1998,"final",null,"BRA","FRA",0,3,false,null,null,"FRA"),
],
2002: [
m(2002,"group","A","FRA","SEN",0,1),m(2002,"group","A","URU","DEN",1,2),m(2002,"group","A","DEN","SEN",1,1),m(2002,"group","A","FRA","URU",0,0),m(2002,"group","A","SEN","URU",3,3),m(2002,"group","A","DEN","FRA",2,0),
m(2002,"group","B","ESP","SVN",3,0),m(2002,"group","B","PAR","RSA",2,2),m(2002,"group","B","ESP","PAR",3,1),m(2002,"group","B","RSA","SVN",1,0),m(2002,"group","B","RSA","ESP",2,3),m(2002,"group","B","SVN","PAR",1,3),
m(2002,"group","C","BRA","TUR",2,1),m(2002,"group","C","CHN","CRC",0,2),m(2002,"group","C","BRA","CHN",4,0),m(2002,"group","C","CRC","TUR",1,1),m(2002,"group","C","TUR","CHN",3,0),m(2002,"group","C","BRA","CRC",5,2),
m(2002,"group","D","KOR","POL",2,0,false,null,null,"KOR"),m(2002,"group","D","USA","POR",3,2),m(2002,"group","D","KOR","USA",1,1,false,null,null,"KOR"),m(2002,"group","D","POR","POL",4,0),m(2002,"group","D","POL","KOR",3,1,false,null,null,"KOR"),m(2002,"group","D","POR","USA",0,1),
m(2002,"group","E","GER","KSA",8,0),m(2002,"group","E","IRL","CMR",1,1),m(2002,"group","E","GER","IRL",1,1),m(2002,"group","E","CMR","KSA",1,0),m(2002,"group","E","CMR","GER",0,2),m(2002,"group","E","KSA","IRL",0,3),
m(2002,"group","F","ARG","NGA",1,0),m(2002,"group","F","ENG","SWE",1,1),m(2002,"group","F","SWE","NGA",2,1),m(2002,"group","F","ARG","ENG",0,1),m(2002,"group","F","SWE","ARG",1,1),m(2002,"group","F","NGA","ENG",0,0),
m(2002,"group","G","ITA","ECU",2,0),m(2002,"group","G","CRO","MEX",0,1),m(2002,"group","G","ITA","CRO",1,2),m(2002,"group","G","MEX","ECU",2,1),m(2002,"group","G","MEX","ITA",1,1),m(2002,"group","G","ECU","CRO",1,0),
m(2002,"group","H","JPN","BEL",2,2,false,null,null,"JPN"),m(2002,"group","H","RUS","TUN",2,0),m(2002,"group","H","JPN","RUS",1,0,false,null,null,"JPN"),m(2002,"group","H","TUN","BEL",1,1),m(2002,"group","H","TUN","JPN",0,2,false,null,null,"JPN"),m(2002,"group","H","BEL","RUS",3,2),
m(2002,"R16",null,"GER","PAR",1,0),m(2002,"R16",null,"DEN","ENG",0,3),m(2002,"R16",null,"SWE","SEN",1,2,true),m(2002,"R16",null,"ESP","IRL",1,1,true,3,2),m(2002,"R16",null,"MEX","USA",0,2),m(2002,"R16",null,"BRA","BEL",2,0),m(2002,"R16",null,"JPN","TUR",0,1,false,null,null,"JPN"),m(2002,"R16",null,"KOR","ITA",2,1,true,null,null,"KOR"),
m(2002,"QF",null,"ENG","BRA",1,2),m(2002,"QF",null,"GER","USA",1,0),m(2002,"QF",null,"ESP","KOR",0,0,true,3,5,"KOR"),m(2002,"QF",null,"SEN","TUR",0,1,true),
m(2002,"SF",null,"GER","KOR",1,0,false,null,null,"KOR"),m(2002,"SF",null,"BRA","TUR",1,0),
m(2002,"third",null,"TUR","KOR",3,2,false,null,null,"KOR"),m(2002,"final",null,"GER","BRA",0,2),
],
2006: [
m(2006,"group","A","GER","CRC",4,2,false,null,null,"GER"),m(2006,"group","A","POL","ECU",0,2),m(2006,"group","A","GER","POL",1,0,false,null,null,"GER"),m(2006,"group","A","ECU","CRC",3,0),m(2006,"group","A","ECU","GER",0,3,false,null,null,"GER"),m(2006,"group","A","CRC","POL",1,2),
m(2006,"group","B","ENG","PAR",1,0),m(2006,"group","B","TRI","SWE",0,0),m(2006,"group","B","ENG","TRI",2,0),m(2006,"group","B","SWE","PAR",1,0),m(2006,"group","B","SWE","ENG",2,2),m(2006,"group","B","PAR","TRI",2,0),
m(2006,"group","C","ARG","CIV",2,1),m(2006,"group","C","SCG","NED",0,1),m(2006,"group","C","ARG","SCG",6,0),m(2006,"group","C","NED","CIV",2,1),m(2006,"group","C","NED","ARG",0,0),m(2006,"group","C","CIV","SCG",3,2),
m(2006,"group","D","MEX","IRN",3,1),m(2006,"group","D","ANG","POR",0,1),m(2006,"group","D","MEX","ANG",0,0),m(2006,"group","D","POR","IRN",2,0),m(2006,"group","D","POR","MEX",2,1),m(2006,"group","D","IRN","ANG",1,1),
m(2006,"group","E","USA","CZE",0,3),m(2006,"group","E","ITA","GHA",2,0),m(2006,"group","E","CZE","GHA",0,2),m(2006,"group","E","ITA","USA",1,1),m(2006,"group","E","CZE","ITA",0,2),m(2006,"group","E","GHA","USA",2,1),
m(2006,"group","F","AUS","JPN",3,1),m(2006,"group","F","BRA","CRO",1,0),m(2006,"group","F","JPN","CRO",0,0),m(2006,"group","F","BRA","AUS",2,0),m(2006,"group","F","JPN","BRA",1,4),m(2006,"group","F","CRO","AUS",2,2),
m(2006,"group","G","KOR","TOG",2,1),m(2006,"group","G","FRA","SUI",0,0),m(2006,"group","G","FRA","KOR",1,1),m(2006,"group","G","TOG","SUI",0,2),m(2006,"group","G","TOG","FRA",0,2),m(2006,"group","G","SUI","KOR",2,0),
m(2006,"group","H","ESP","UKR",4,0),m(2006,"group","H","TUN","KSA",2,2),m(2006,"group","H","KSA","UKR",0,4),m(2006,"group","H","ESP","TUN",3,1),m(2006,"group","H","KSA","ESP",0,1),m(2006,"group","H","UKR","TUN",1,0),
],
2010: [
m(2010,"group","A","RSA","MEX",1,1,false,null,null,"RSA"),m(2010,"group","A","URU","FRA",0,0),m(2010,"group","A","RSA","URU",0,3,false,null,null,"RSA"),m(2010,"group","A","FRA","MEX",0,2),m(2010,"group","A","MEX","URU",0,1),m(2010,"group","A","FRA","RSA",1,2,false,null,null,"RSA"),
m(2010,"group","B","KOR","GRE",2,0),m(2010,"group","B","ARG","NGA",1,0),m(2010,"group","B","ARG","KOR",4,1),m(2010,"group","B","GRE","NGA",2,1),m(2010,"group","B","NGA","KOR",2,2),m(2010,"group","B","GRE","ARG",0,2),
m(2010,"group","C","ENG","USA",1,1),m(2010,"group","C","ALG","SVN",0,1),m(2010,"group","C","SVN","USA",2,2),m(2010,"group","C","ENG","ALG",0,0),m(2010,"group","C","SVN","ENG",0,1),m(2010,"group","C","USA","ALG",1,0),
m(2010,"group","D","SRB","GHA",0,1),m(2010,"group","D","GER","AUS",4,0),m(2010,"group","D","GER","SRB",0,1),m(2010,"group","D","GHA","AUS",1,1),m(2010,"group","D","GHA","GER",0,1),m(2010,"group","D","AUS","SRB",2,1),
m(2010,"group","E","NED","DEN",2,0),m(2010,"group","E","JPN","CMR",1,0),m(2010,"group","E","NED","JPN",1,0),m(2010,"group","E","CMR","DEN",1,2),m(2010,"group","E","DEN","JPN",1,3),m(2010,"group","E","CMR","NED",1,2),
m(2010,"group","F","ITA","PAR",1,1),m(2010,"group","F","NZL","SVK",1,1),m(2010,"group","F","SVK","PAR",0,2),m(2010,"group","F","ITA","NZL",1,1),m(2010,"group","F","SVK","ITA",3,2),m(2010,"group","F","PAR","NZL",0,0),
m(2010,"group","G","CIV","POR",0,0),m(2010,"group","G","BRA","PRK",2,1),m(2010,"group","G","BRA","CIV",3,1),m(2010,"group","G","POR","PRK",7,0),m(2010,"group","G","POR","BRA",0,0),m(2010,"group","G","PRK","CIV",0,3),
m(2010,"group","H","HON","CHI",0,1),m(2010,"group","H","ESP","SUI",0,1),m(2010,"group","H","CHI","SUI",1,0),m(2010,"group","H","ESP","HON",2,0),m(2010,"group","H","CHI","ESP",1,2),m(2010,"group","H","SUI","HON",0,0),
],
2018: [
m(2018,"group","A","RUS","KSA",5,0,false,null,null,"RUS"),m(2018,"group","A","EGY","URU",0,1),m(2018,"group","A","RUS","EGY",3,1,false,null,null,"RUS"),m(2018,"group","A","URU","KSA",1,0),m(2018,"group","A","URU","RUS",3,0,false,null,null,"RUS"),m(2018,"group","A","KSA","EGY",2,1),
m(2018,"group","B","MAR","IRN",0,1),m(2018,"group","B","POR","ESP",3,3),m(2018,"group","B","POR","MAR",1,0),m(2018,"group","B","IRN","ESP",0,1),m(2018,"group","B","IRN","POR",1,1),m(2018,"group","B","ESP","MAR",2,2),
m(2018,"group","C","FRA","AUS",2,1),m(2018,"group","C","PER","DEN",0,1),m(2018,"group","C","DEN","AUS",1,1),m(2018,"group","C","FRA","PER",1,0),m(2018,"group","C","DEN","FRA",0,0),m(2018,"group","C","AUS","PER",0,2),
m(2018,"group","D","ARG","ISL",1,1),m(2018,"group","D","CRO","NGA",2,0),m(2018,"group","D","ARG","CRO",0,3),m(2018,"group","D","NGA","ISL",2,0),m(2018,"group","D","NGA","ARG",1,2),m(2018,"group","D","ISL","CRO",1,2),
m(2018,"group","E","CRC","SRB",0,1),m(2018,"group","E","BRA","SUI",1,1),m(2018,"group","E","BRA","CRC",2,0),m(2018,"group","E","SRB","SUI",1,2),m(2018,"group","E","SRB","BRA",0,2),m(2018,"group","E","SUI","CRC",2,2),
m(2018,"group","F","GER","MEX",0,1),m(2018,"group","F","SWE","KOR",1,0),m(2018,"group","F","KOR","MEX",1,2),m(2018,"group","F","GER","SWE",2,1),m(2018,"group","F","KOR","GER",2,0),m(2018,"group","F","MEX","SWE",0,3),
m(2018,"group","G","BEL","PAN",3,0),m(2018,"group","G","TUN","ENG",1,2),m(2018,"group","G","BEL","TUN",5,2),m(2018,"group","G","ENG","PAN",6,1),m(2018,"group","G","ENG","BEL",0,1),m(2018,"group","G","PAN","TUN",1,2),
m(2018,"group","H","COL","JPN",1,2),m(2018,"group","H","POL","SEN",1,2),m(2018,"group","H","JPN","SEN",2,2),m(2018,"group","H","POL","COL",0,3),m(2018,"group","H","JPN","POL",0,1),m(2018,"group","H","SEN","COL",0,1),
],
2022: [
m(2022,"group","A","ECU","QAT",2,0,false,null,null,"QAT"),m(2022,"group","A","SEN","NED",0,2),m(2022,"group","A","QAT","SEN",1,3,false,null,null,"QAT"),m(2022,"group","A","NED","ECU",1,1),m(2022,"group","A","ECU","SEN",1,2),m(2022,"group","A","NED","QAT",2,0,false,null,null,"QAT"),
m(2022,"group","B","ENG","IRN",6,2),m(2022,"group","B","USA","WAL",1,1),m(2022,"group","B","WAL","IRN",0,2),m(2022,"group","B","ENG","USA",0,0),m(2022,"group","B","WAL","ENG",0,3),m(2022,"group","B","IRN","USA",0,1),
m(2022,"group","C","ARG","KSA",1,2),m(2022,"group","C","MEX","POL",0,0),m(2022,"group","C","POL","KSA",2,0),m(2022,"group","C","ARG","MEX",2,0),m(2022,"group","C","POL","ARG",0,2),m(2022,"group","C","KSA","MEX",1,2),
m(2022,"group","D","DEN","TUN",0,0),m(2022,"group","D","FRA","AUS",4,1),m(2022,"group","D","TUN","AUS",0,1),m(2022,"group","D","FRA","DEN",2,1),m(2022,"group","D","AUS","DEN",1,0),m(2022,"group","D","TUN","FRA",1,0),
m(2022,"group","E","GER","JPN",1,2),m(2022,"group","E","ESP","CRC",7,0),m(2022,"group","E","JPN","CRC",0,1),m(2022,"group","E","ESP","GER",1,1),m(2022,"group","E","JPN","ESP",2,1),m(2022,"group","E","CRC","GER",2,4),
m(2022,"group","F","MAR","CRO",0,0),m(2022,"group","F","BEL","CAN",1,0),m(2022,"group","F","BEL","MAR",0,2),m(2022,"group","F","CRO","CAN",4,1),m(2022,"group","F","CRO","BEL",0,0),m(2022,"group","F","CAN","MAR",1,2),
m(2022,"group","G","SUI","CMR",1,0),m(2022,"group","G","BRA","SRB",2,0),m(2022,"group","G","CMR","SRB",3,3),m(2022,"group","G","BRA","SUI",1,0),m(2022,"group","G","SRB","SUI",2,3),m(2022,"group","G","CMR","BRA",1,0),
m(2022,"group","H","URU","KOR",0,0),m(2022,"group","H","POR","GHA",3,2),m(2022,"group","H","KOR","GHA",2,3),m(2022,"group","H","POR","URU",2,0),m(2022,"group","H","GHA","URU",0,2),m(2022,"group","H","KOR","POR",2,1),
],
};

// Per-team squad-strength index (share of 26-man squad at top-5 European
// league clubs). Sourced from the 2026 FIFA World Cup squads Wikipedia
// article (fetched 2026-05-21). 33 teams have data; 15 squads were
// still pending official announcement as of Mai 2026 — they get an
// era-median placeholder of 0.30 and the squadEloAdjustments function
// translates that to a zero delta.
export const SQUAD_INDEX_2026 = {
  // Teams with confirmed squads
  MEX: 0.11, FRA: 0.92, ARG: 0.64, POR: 0.65, BRA: 0.54, BEL: 0.77,
  GER: 0.96, CRO: 0.65, COL: 0.22, SUI: 0.88, JPN: 0.50, SEN: 0.75,
  IRN: 0.00, TUR: 0.29, AUT: 0.69, KOR: 0.19, EGY: 0.15, SCO: 0.50,
  PAR: 0.11, TUN: 0.27, CIV: 0.50, UZB: 0.03, QAT: 0.00, JOR: 0.03,
  CPV: 0.04, CUW: 0.00, HAI: 0.15, NZL: 0.08, IRQ: 0.03, COD: 0.42,
  BIH: 0.23, CZE: 0.24, SWE: 0.62,
  // Teams pending squad announcement → era-median placeholder
  USA: 0.30, CAN: 0.30, ESP: 0.30, ENG: 0.30, NED: 0.30, MAR: 0.30,
  URU: 0.30, ECU: 0.30, AUS: 0.30, NOR: 0.30, PAN: 0.30, ALG: 0.30,
  KSA: 0.30, RSA: 0.30, GHA: 0.30,
};

export const SQUAD_INDEX_2026_META = {
  asOf: "2026-05-21",
  source: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads",
  method: "top-5-European-league share of the announced 26-man squad",
  teamsWithData: 33,
  teamsPending: 15,
};
