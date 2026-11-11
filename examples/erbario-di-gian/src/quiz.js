export function scoreQuiz(items, answers) {
 if (!items.length || items.some(i => !Object.prototype.hasOwnProperty.call(answers, i.name) || typeof answers[i.name] !== 'string' || !answers[i.name])) throw Error('Devi rispondere a tutte le domande.');
 const errors = items.filter(i => answers[i.name] !== i.color).map(i => i.name);
 return {correct: items.length - errors.length, total: items.length, errors};
}
