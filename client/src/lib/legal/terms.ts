/* The Terms & Conditions text — one source for the registration dialog
   (components/auth/TermsModal.tsx) and the public /terms page. Plain data,
   no 'use client', so a server page can render it. */
export const TERMS_SECTIONS: { title: string; content: string[] }[] = [
  {
    title: 'Acceptance of the Terms',
    content: [
      'By registering for the Course offered by Delta, either through online platforms or in-person enrolment, you acknowledge that you have read, understood, and agreed to be bound by these Terms in full.',
      'Enrolment to the Course is subject to availability and is not guaranteed until explicitly confirmed by us as per the Terms herein. We reserve the right to accept or reject any application for enrolment at our sole discretion.',
    ],
  },
  {
    title: 'Nature and Scope of the Course',
    content: [
      'The Course is intended and offered solely for educational and informational purposes relating to virtual and forex trading (the "Subject"), and does not constitute any kind of professional, financial, legal or investment advice, or solicitation to trade.',
      'Delta makes no warranties or representations as to the accuracy, completeness, or usefulness of the Course. You agree that any trading or investment decisions are made independently at your sole risk.',
      'Delta shall not be liable for any losses, financial or otherwise, arising out of or in connection with the Course content or actions taken based on it.',
    ],
  },
  {
    title: 'Course Materials and Intellectual Property',
    content: [
      'All Course content, including but not limited to logos, trademarks, trade names, copyrights, and any videos, presentations, slides, written materials, images, and lectures (collectively, the "Course Content") shall be the exclusive property of Delta. All intellectual property rights over the Course Content are hereby reserved by Delta.',
      'Upon enrolment, you are granted a limited, non-exclusive, non-transferable, revocable license to access and use the Course Content solely for purposes relating to the Subject as agreed herein.',
      'Any form of unauthorized storage, reproduction, distribution, modification, public display, or commercial use of any Course Content is strictly prohibited and may result in immediate legal action, including seeking injunctive relief or damages, and termination of enrolment of the Student.',
    ],
  },
  {
    title: 'Course Fees and Payment',
    content: [
      'All Course fees must be paid in full prior to commencement, unless otherwise agreed in writing by Delta. Any instalment or deferred payment arrangements must be strictly adhered to as mutually agreed.',
      'Any fees paid are non-refundable and non-transferable under any circumstances, including withdrawal, termination, dissatisfaction, or partial completion.',
      'Enrolment shall be deemed complete only upon: (1) Submission of completed registration documents, (2) Payment and receipt of fees as agreed, and (3) Issuance of official confirmation from Delta via email or written notice.',
      'Delta reserves the right to withhold services or disqualify any Student for reasons including, but not limited to, any payment failure, misrepresentation, false information, and/or breach of any Terms herein.',
      'Please refer to our Payment and Refund Policy for further details.',
    ],
  },
  {
    title: 'Educational Trading Credit',
    content: [
      'As part of the Course, Delta may provide the Student with access to a trading credit scheme ("Trading Credit") offered by an independent third-party brokerage company ("Broker") for the purpose of gaining experience trading on a trading platform ("Platform").',
      'Creation of the account with the Broker and availing the Trading Credit shall be entirely voluntary and at the sole discretion of the Student. Any such access provided shall be subject to successful registration, KYC completion, and approval by the Broker.',
      'The Trading Credit provided shall be subject to the Broker\'s terms and conditions. Delta does not own, operate, or control the Platform or the Broker and shall not be held liable directly or indirectly, for the actions, omissions or decisions of the Broker or the Platform in any manner. The Trading Credit cannot be redeemed for cash or withdrawn in any other manner. However, profit earned through trading, above and beyond the Trading Credit, shall be available for withdrawal subject to charges and withdrawal limits of the Broker.',
      'The Trading Credit does not form part of the Course fee, nor does it constitute a guaranteed benefit, right or entitlement in any manner. You acknowledge and agree that any participation or interaction with the Broker is undertaken at your sole risk and responsibility.',
    ],
  },
  {
    title: 'Code of Conduct',
    content: [
      'Students must at all times: (1) Conduct themselves in a respectful and professional manner, as ordinarily expected from a student; (2) Abide by all rules, regulations, and policies communicated during the Course.',
      'Delta reserves the right to suspend or expel any Student, without refund or notice, for any: (1) Disruptive, harassing, abusive, or unethical conduct or behavior; (2) Misuse or unauthorized sharing of Course Content; (3) Academic dishonesty or fraudulent activity.',
    ],
  },
  {
    title: 'Disclaimers and Limitation of Liability',
    content: [
      'Trading in financial markets involves substantial risk. You acknowledge and agree that any past performance is not indicative of future results.',
      'To the extent permitted by law, Delta and/or its Affiliates shall not be liable for any: (1) Direct, indirect, incidental, special, or consequential damages; (2) Loss of profits, capital, data, or goodwill; (3) Technical failures, internet disruptions, or platform outages; (4) Any other damages resulting from your decision to take part in or conduct any form of trading or related activity during or after the term of the Course.',
      'You agree to indemnify, defend and hold harmless Delta and its Affiliates from any claims, damages, expenses or liabilities arising from the breach of these Terms, any trading activity or your conduct during or after the term of the Course.',
    ],
  },
  {
    title: 'Data Protection and Privacy',
    content: [
      'You agree to provide accurate, current, and complete information for registration and during the term of this Course.',
      'Your personal data shall be collected, stored and processed in accordance with applicable data protection laws of the UAE.',
      'Delta shall not share your information with any third parties except as required by law.',
    ],
  },
  {
    title: 'Amendments and Modifications',
    content: [
      'Delta reserves the right, at its sole discretion, to: (1) Amend, revise, or update these Terms; (2) Modify Course structure, content, fees, or instructors; (3) Suspend or discontinue the Course in whole or in part.',
      'Any amendments or modifications to the Terms shall be published on Delta\'s website. Continued participation or attendance in the Course after any such amendment constitutes acceptance of the revised Terms.',
    ],
  },
  {
    title: 'Term and Termination',
    content: [
      'These Terms shall come into effect from the date of your enrolment in the Course, as confirmed in writing by Delta, or the date of your signing or acceptance of the terms, whichever is earlier, and shall remain in force until the completion of the Course, unless earlier terminated.',
      'Upon termination for any reason: (1) The Student\'s access to the Course Content, platforms, and any materials shall cease immediately; (2) The Student shall immediately cease all use of the Course Content and return, delete or destroy any copies in their possession; (3) Termination shall be without prejudice to any accrued rights, remedies, or obligations of Delta.',
    ],
  },
  {
    title: 'Severability',
    content: [
      'If any provision of these Terms is found to be invalid, void, or unenforceable under applicable law, such provision shall be severed without affecting the validity of the remaining Terms, which shall remain in full force and effect.',
    ],
  },
  {
    title: 'Governing Law and Dispute Resolution',
    content: [
      'These Terms shall be governed by and construed in accordance with the applicable Federal laws of the United Arab Emirates and the local laws of the Emirate of Dubai.',
      'Any disputes arising from or relating to these Terms shall be first resolved amicably through mutual negotiations. In case of failure to settle the dispute within thirty days of initiating such negotiation, the matter shall be exclusively submitted to the Courts of the Emirate of Dubai.',
    ],
  },
]
